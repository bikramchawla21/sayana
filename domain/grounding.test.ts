import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_ANSWER,
  groundDumpExtract,
  groundVaultAnswer,
  guardCompanionReply,
  quoteIsInSource,
  rankVaultSessions,
  safeCompanionReply,
  type RawDump,
} from "./grounding.ts";

const transcript =
  "I need to make twenty cold calls in Gurgaon and email Priya the deck by Friday. Feeling wiped but that's the job.";

const invented: RawDump = {
  languageMix: "en",
  lane: "work",
  overwhelmed: false,
  summaryBullets: [
    {
      text: "I need to make 20 cold calls in Gurgaon.",
      evidence: "make twenty cold calls in Gurgaon",
    },
    {
      text: "I closed a Series A yesterday.",
      evidence: "I closed a Series A yesterday",
    },
  ],
  steps: [
    {
      title: "Make 20 cold calls in Gurgaon",
      dueHint: "Friday",
      evidence: "make twenty cold calls in Gurgaon",
    },
    {
      title: "Make 20 cold calls in Gurgaon",
      dueHint: "Monday",
      evidence: "make twenty cold calls in Gurgaon",
    },
    {
      title: "Make 50 cold calls",
      evidence: "make twenty cold calls",
    },
    {
      title: "Book a flight to Dubai",
      evidence: "book a flight to Dubai",
    },
  ],
  people: [
    { name: "Priya", evidence: "email Priya the deck" },
    { name: "Rahul", evidence: "email Priya the deck" },
  ],
  decisions: [{ title: "I hired a COO", evidence: "I hired a COO" }],
  commitments: [],
  ideas: [],
  questions: [],
  openLoops: [],
};

describe("grounding eval", () => {
  it("drops invented facts and keeps what was said", () => {
    const before = {
      bullets: invented.summaryBullets?.length ?? 0,
      steps: invented.steps?.length ?? 0,
      people: invented.people?.length ?? 0,
      decisions: invented.decisions?.length ?? 0,
    };
    const after = groundDumpExtract(invented, transcript);

    assert.equal(before.bullets + before.steps + before.people + before.decisions, 9);
    assert.equal(after.summaryBullets.some((line) => /series a/i.test(line)), false);
    assert.equal(after.summaryBullets.some((line) => /20 cold calls/i.test(line)), true);
    assert.deepEqual(
      after.steps.map((step) => step.title),
      ["Make 20 cold calls in Gurgaon"],
    );
    assert.equal(after.steps[0]?.dueHint, "Friday");
    assert.deepEqual(after.people.map((person) => person.name), ["Priya"]);
    assert.equal(after.decisions.length, 0);
    assert.equal(after.lane, "work");
    assert.equal(after.steps.some((step) => /dubai|50/i.test(step.title)), false);
  });

  it("does not keep a work lane when every task was invented", () => {
    const after = groundDumpExtract(
      {
        lane: "work",
        summaryBullets: [
          {
            text: "I need to make 20 cold calls in Gurgaon.",
            evidence: "make twenty cold calls in Gurgaon",
          },
        ],
        steps: [{ title: "Book a flight to Dubai", evidence: "book a flight to Dubai" }],
      },
      transcript,
    );
    assert.equal(after.steps.length, 0);
    assert.equal(after.lane, "life");
    assert.match(after.summary, /20 cold calls/);
  });

  it("keeps a Hindi item only when the quote is really in the rant", () => {
    const hindi = "आज मैंने प्रिया से कहा कि डेक भेजना बाकी है और बीस कॉल करने हैं";
    const after = groundDumpExtract(
      {
        languageMix: "hi",
        lane: "work",
        summaryBullets: [{ text: "I still have to send the deck.", evidence: "डेक भेजना बाकी है" }],
        steps: [
          { title: "Send the deck", evidence: "डेक भेजना बाकी है" },
          { title: "Make 50 calls", evidence: "बीस कॉल करने हैं" },
          { title: "Book a flight to Dubai", evidence: "डेक भेजना बाकी है" },
        ],
        people: [{ name: "Priya", evidence: "प्रिया से कहा" }],
      },
      hindi,
    );
    assert.equal(quoteIsInSource("डेक भेजना बाकी है", hindi), true);
    assert.deepEqual(after.steps.map((step) => step.title), ["Send the deck"]);
    assert.equal(after.people.length, 0);
    assert.equal(after.summaryBullets.some((line) => /send the deck/i.test(line)), true);
  });

  it("replaces a companion reply that adds people or counts", () => {
    const inventedReply = guardCompanionReply("You should also call Rahul and make 50 more.", transcript, false);
    assert.equal(inventedReply, safeCompanionReply(false));
    const mirrored = guardCompanionReply("Twenty cold calls in Gurgaon is a lot.", transcript, false);
    assert.equal(mirrored, "Twenty cold calls in Gurgaon is a lot.");
    const presence = guardCompanionReply("You will be fine by Monday.", transcript, true);
    assert.equal(presence, safeCompanionReply(true));
  });

  it("rejects a vault answer whose citation or number is not in the dump", () => {
    const sources = [{ id: "s1", day: "2026-11-10", transcript }];
    const kept = groundVaultAnswer(
      {
        known: true,
        answer: "You said you would make 20 cold calls in Gurgaon and email Priya.",
        citations: [
          {
            sessionId: "s1",
            day: "2026-11-10",
            quote: "make twenty cold calls in Gurgaon and email Priya the deck",
          },
        ],
      },
      sources,
    );
    assert.equal(kept.known, true);
    assert.equal(kept.citations.length, 1);
    assert.match(kept.answer, /Priya/);

    const wrongCount = groundVaultAnswer(
      {
        known: true,
        answer: "You said 50 cold calls.",
        citations: [{ sessionId: "s1", day: "wrong", quote: "make twenty cold calls in Gurgaon" }],
      },
      sources,
    );
    assert.equal(wrongCount.known, false);
    assert.equal(wrongCount.answer, UNKNOWN_ANSWER);

    const fakeQuote = groundVaultAnswer(
      {
        known: true,
        answer: "You booked a flight.",
        citations: [{ sessionId: "s1", day: "2026-11-10", quote: "book a flight to Dubai" }],
      },
      sources,
    );
    assert.equal(fakeQuote.known, false);
  });

  it("ranks dumps that actually mention the question", () => {
    const ranked = rankVaultSessions("what did I promise Priya", [
      { id: "other", transcript: "I went for a walk and felt tired." },
      { id: "hit", transcript },
    ]);
    assert.deepEqual(ranked.map((row) => row.id), ["hit"]);
    assert.equal(rankVaultSessions("quantum superconductors", [{ id: "hit", transcript }]).length, 0);
  });
});
