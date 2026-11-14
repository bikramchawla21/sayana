import { bulletsToSummary, takeFive } from "./step-identity";
import type { DumpExtract, DumpLane, ExtractedKind, ExtractedLoop, ExtractedPerson, ExtractedStep, LanguageMix } from "./types";

/**
 * Facts Sayana stores or says back have to be in the source text.
 * A quote must be copied from that text. Names, numbers, and dates that
 * were not spoken are dropped. When nothing survives, the reply says so
 * instead of guessing.
 */

const FILLER = new Set(
  `will would could should shall said say says feel feeling felt told tell think thinking thought know knew still even back again actually basically literally maybe probably already want wanted wants gonna gotta need needs needed really very just like`.split(
    " ",
  ),
);

const VERBS = new Set(
  `call calls calling email emails emailing send sending sent make making made text texts texting meet meeting ping book booking finish finishing write writing pay paying buy buying check checking follow following schedule scheduling message messaging reply replying review reviewing ship shipping update updating talk talking visit visiting submit submitting prepare preparing draft drafting share sharing do did doing get got going work working`.split(
    " ",
  ),
);

const STOP = new Set(
  `a an the and or but if then so to of in on at for from with as is was were be been being i me my we our you your he she it they them this that these those not no yes too also about into over after before have has had uh um yeah ok okay im thats`.split(
    " ",
  ),
);

const PRESENCE = new Set(
  `i im okay ok aur bata main yahan hoon hun bol listening here with you sayana hindi english hinglish yeah haan theek thik today tonight`.split(
    " ",
  ),
);

const DATED = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "tomorrow",
  "yesterday",
];

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const HI_NUM: Record<string, string> = {
  शून्य: "0",
  एक: "1",
  दो: "2",
  तीन: "3",
  चार: "4",
  पांच: "5",
  पाँच: "5",
  छह: "6",
  सात: "7",
  आठ: "8",
  नौ: "9",
  दस: "10",
  ग्यारह: "11",
  बारह: "12",
  तेरह: "13",
  चौदह: "14",
  पंद्रह: "15",
  सोलह: "16",
  सत्रह: "17",
  अठारह: "18",
  उन्नीस: "19",
  बीस: "20",
  तीस: "30",
  चालीस: "40",
  पचास: "50",
  साठ: "60",
  सत्तर: "70",
  अस्सी: "80",
  नब्बे: "90",
  सौ: "100",
};

export const UNKNOWN_ANSWER = "I don't have that in your dumps.";

export type RawItem = {
  title?: string | null;
  dueHint?: string | null;
  personName?: string | null;
  overdueHint?: string | null;
  evidence?: string | null;
};

export type RawDump = {
  summary?: string | null;
  summaryBullets?: Array<string | { text?: string | null; evidence?: string | null }> | null;
  languageMix?: string | null;
  lane?: string | null;
  overwhelmed?: boolean | null;
  steps?: RawItem[] | null;
  people?: Array<{ name?: string | null; evidence?: string | null }> | null;
  openLoops?: RawItem[] | null;
  commitments?: RawItem[] | null;
  decisions?: RawItem[] | null;
  ideas?: RawItem[] | null;
  questions?: RawItem[] | null;
};

export type VaultSource = {
  id: string;
  day: string;
  transcript: string;
};

export type VaultCitation = {
  sessionId: string;
  day: string;
  quote: string;
};

export type VaultAnswer = {
  answer: string;
  known: boolean;
  citations: VaultCitation[];
};

export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteIsInSource(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote);
  const s = normalizeForQuote(source);
  if (q.length < 8) return false;
  return s.includes(q);
}

export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.match(/\b\d+(?:\.\d+)?\b/g) ?? []) {
    found.add(match);
    if (/^\d+$/.test(match)) found.add(String(Number(match)));
  }
  const words = normalizeForQuote(text).split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word in ONES) found.add(String(ONES[word]));
    if (word in TENS) {
      const next = words[i + 1];
      if (next && next in ONES && ONES[next] < 10) {
        found.add(String(TENS[word] + ONES[next]));
        i += 1;
      } else {
        found.add(String(TENS[word]));
      }
    }
    if (word === "hundred") found.add("100");
    if (word === "thousand") found.add("1000");
  }
  for (const token of text.match(/[\u0900-\u097F]+/g) ?? []) {
    const n = HI_NUM[token];
    if (n) found.add(n);
  }
  return found;
}

function hasToken(source: string, token: string): boolean {
  const bag = ` ${normalizeForQuote(source)} `;
  return bag.includes(` ${token} `);
}

function anchors(text: string): string[] {
  return normalizeForQuote(text)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP.has(token) && !FILLER.has(token) && !VERBS.has(token));
}

function anchorsMatch(text: string, source: string): boolean {
  const need = anchors(text);
  if (!need.length) return false;
  return need.every((token) => hasToken(source, token));
}

function mentionsDated(text: string, word: string): boolean {
  // "may" is also a verb. Only the month, written "May", counts.
  if (word === "may") return /\bMay\b/.test(text);
  return hasToken(text, word);
}

function datedWordsSupported(claim: string, source: string): boolean {
  for (const word of DATED) {
    if (mentionsDated(claim, word) && !mentionsDated(source, word)) return false;
  }
  return true;
}

function numbersSupported(claim: string, source: string): boolean {
  const sourceNums = numbersIn(source);
  for (const n of numbersIn(claim)) {
    if (!sourceNums.has(n)) return false;
  }
  return true;
}

function mostlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return false;
  const nonLatin = letters.filter((ch) => !/[A-Za-z]/.test(ch)).length;
  return nonLatin / letters.length > 0.45;
}

function capitalizedWords(text: string): string[] {
  const words = text.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
  const out: string[] = [];
  for (const word of words) {
    if (!/^[A-Z]/.test(word)) continue;
    const key = word.toLowerCase().replace(/['’]/g, "");
    if (key.length < 3) continue;
    if (PRESENCE.has(key) || STOP.has(key) || FILLER.has(key) || VERBS.has(key)) continue;
    out.push(key);
  }
  return out;
}

function capitalsSupported(claim: string, source: string): boolean {
  return capitalizedWords(claim).every((word) => hasToken(source, word));
}

export function claimIsGrounded(claim: string, source: string, evidence?: string | null): boolean {
  const text = claim.trim();
  if (!text) return false;
  if (!numbersSupported(text, source)) return false;
  if (!datedWordsSupported(text, source)) return false;
  if (!capitalsSupported(text, source)) return false;
  const ev = (evidence ?? "").trim();
  const quoted = ev ? quoteIsInSource(ev, source) : false;
  if (mostlyNonLatin(source)) return quoted;
  if (anchors(text).length === 0) return numbersIn(text).size > 0 || DATED.some((word) => hasToken(text, word));
  return anchorsMatch(text, source);
}

function cleanPerson(name: string | null | undefined, source: string): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  if (/^(user|speaker|someone|somebody|they|them|me|i)$/i.test(trimmed)) return null;
  if (!hasToken(source, normalizeForQuote(trimmed))) return null;
  return trimmed;
}

function asKind(item: RawItem, source: string): ExtractedKind | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;
  if (!claimIsGrounded(title, source, item.evidence)) return null;
  const dueHint = (item.dueHint ?? "").trim();
  const personName = cleanPerson(item.personName, source);
  return {
    title,
    dueHint: dueHint && claimIsGrounded(dueHint, source, null) ? dueHint : null,
    personName,
  };
}

function uniqueKinds(items: RawItem[] | null | undefined, source: string, limit = 5): ExtractedKind[] {
  const out: ExtractedKind[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const kept = asKind(item, source);
    if (!kept) continue;
    const key = kept.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kept);
    if (out.length >= limit) break;
  }
  return out;
}

function uniqueSteps(items: RawItem[] | null | undefined, source: string): ExtractedStep[] {
  const out: ExtractedStep[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const kept = asKind(item, source);
    if (!kept) continue;
    const key = kept.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const overdue = (item.overdueHint ?? "").trim();
    out.push({
      ...kept,
      overdueHint: overdue && claimIsGrounded(overdue, source, null) ? overdue : null,
    });
    if (out.length >= 5) break;
  }
  return out;
}

function uniquePeople(
  people: Array<{ name?: string | null; evidence?: string | null }> | null | undefined,
  source: string,
): ExtractedPerson[] {
  const out: ExtractedPerson[] = [];
  const seen = new Set<string>();
  for (const person of people ?? []) {
    const name = cleanPerson(person.name, source);
    if (!name) continue;
    if (mostlyNonLatin(source)) {
      const ev = (person.evidence ?? "").trim();
      if (!ev || !quoteIsInSource(ev, source)) continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
    if (out.length >= 8) break;
  }
  return out;
}

function bulletParts(bullet: string | { text?: string | null; evidence?: string | null }): { text: string; evidence: string } {
  if (typeof bullet === "string") return { text: bullet, evidence: "" };
  return { text: (bullet.text ?? "").trim(), evidence: (bullet.evidence ?? "").trim() };
}

function fallbackBullets(transcript: string): string[] {
  const trimmed = transcript.trim();
  if (!trimmed) return ["I dumped a bit."];
  if (mostlyNonLatin(trimmed)) return ["I talked through a dump in Hindi."];
  return [`I said: ${trimmed.slice(0, 180)}`];
}

function mixOf(raw: string | null | undefined, transcript: string): LanguageMix {
  if (raw === "en" || raw === "hi" || raw === "hinglish") return raw;
  const hasDeva = /[\u0900-\u097F]/.test(transcript);
  const hasLatin = /[a-zA-Z]/.test(transcript);
  if (hasDeva && hasLatin) return "hinglish";
  if (hasDeva) return "hi";
  return "en";
}

export function groundDumpExtract(raw: RawDump, transcript: string): DumpExtract {
  const summaryBullets = takeFive(
    (raw.summaryBullets ?? [])
      .map(bulletParts)
      .filter((bullet) => bullet.text && claimIsGrounded(bullet.text, transcript, bullet.evidence))
      .map((bullet) => bullet.text),
  );
  const bullets = summaryBullets.length ? summaryBullets : fallbackBullets(transcript);
  const steps = uniqueSteps(raw.steps, transcript);
  const commitments = uniqueKinds(raw.commitments, transcript);
  const openLoops: ExtractedLoop[] = uniqueKinds(raw.openLoops, transcript).map((item) => ({
    title: item.title,
    personName: item.personName,
  }));
  const decisions = uniqueKinds(raw.decisions, transcript);
  const ideas = uniqueKinds(raw.ideas, transcript);
  const questions = uniqueKinds(raw.questions, transcript);
  const people = uniquePeople(raw.people, transcript);
  const logistics = steps.length + commitments.length + openLoops.length;
  let lane: DumpLane = raw.lane === "life" ? "life" : "work";
  if (logistics > 0) lane = "work";
  else if (decisions.length + ideas.length + questions.length === 0) lane = "life";
  else if (raw.lane === "life") lane = "life";

  return {
    summary: bulletsToSummary(bullets),
    summaryBullets: bullets,
    languageMix: mixOf(raw.languageMix, transcript),
    lane,
    overwhelmed: Boolean(raw.overwhelmed),
    steps,
    people,
    openLoops,
    commitments,
    decisions,
    ideas,
    questions,
  };
}

export function unsupportedProperNames(text: string, corpus: string): string[] {
  const bad: string[] = [];
  const sentences = text.split(/(?<=[.!?।])\s+/);
  for (const sentence of sentences) {
    const words = sentence.match(/[A-Za-z][A-Za-z'’]*/g) ?? [];
    words.forEach((word, index) => {
      if (index === 0 || !/^[A-Z]/.test(word)) return;
      const key = word.toLowerCase().replace(/['’]/g, "");
      if (key.length < 3 || PRESENCE.has(key) || VERBS.has(key)) return;
      if (!hasToken(corpus, key)) bad.push(word);
    });
  }
  return bad;
}

export function safeCompanionReply(overwhelmed: boolean): string {
  return overwhelmed
    ? "Main yahan hoon. Bol, I’m listening."
    : "Okay. I’m with you — we’ll sort the rest on Today when you’re ready.";
}

export function guardCompanionReply(reply: string, transcript: string, overwhelmed: boolean): string {
  const text = reply.trim();
  const safe = safeCompanionReply(overwhelmed);
  if (!text) return safe;
  if (!numbersSupported(text, transcript)) return safe;
  if (!datedWordsSupported(text, transcript)) return safe;
  if (unsupportedProperNames(text, transcript).length) return safe;
  return text;
}

export function groundVaultAnswer(
  raw: { answer?: string | null; known?: boolean | null; citations?: VaultCitation[] | null },
  sources: VaultSource[],
): VaultAnswer {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const valid: VaultCitation[] = [];
  const seen = new Set<string>();
  for (const citation of raw.citations ?? []) {
    const source = byId.get(citation.sessionId);
    if (!source) continue;
    const quote = (citation.quote ?? "").trim();
    if (!quoteIsInSource(quote, source.transcript)) continue;
    const key = `${source.id}:${normalizeForQuote(quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ sessionId: source.id, day: source.day, quote });
  }
  const unknown = { answer: UNKNOWN_ANSWER, known: false, citations: [] as VaultCitation[] };
  if (!raw.known || valid.length === 0) return unknown;
  const answer = (raw.answer ?? "").trim();
  if (!answer) return unknown;
  const cited = valid.map((citation) => citation.quote).join("\n");
  if (!numbersSupported(answer, cited)) return unknown;
  if (!datedWordsSupported(answer, cited)) return unknown;
  if (unsupportedProperNames(answer, cited).length) return unknown;
  return { answer, known: true, citations: valid };
}

export function rankVaultSessions<T extends { transcript: string }>(query: string, sessions: T[], limit = 8): T[] {
  const tokens = anchors(query);
  if (!tokens.length) return [];
  return sessions
    .map((session, index) => {
      const score = tokens.reduce((n, token) => n + (hasToken(session.transcript, token) ? 1 : 0), 0);
      return { session, score, index };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.session);
}
