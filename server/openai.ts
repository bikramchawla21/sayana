import OpenAI from "openai";
import { z } from "zod";
import {
  groundDumpExtract,
  groundVaultAnswer,
  guardCompanionReply,
  safeCompanionReply,
  UNKNOWN_ANSWER,
  type RawDump,
  type VaultAnswer,
  type VaultSource,
} from "@/domain/grounding";
import { ASK_SYSTEM, COMPANION_SYSTEM, EXTRACT_SYSTEM } from "@/domain/prompts";
import { hasArabicScript } from "@/domain/script";
import { bulletsToSummary, takeFive } from "@/domain/step-identity";
import type { DumpExtract } from "@/domain/types";

const kindItem = z.object({
  title: z.string(),
  dueHint: z.string().nullable().optional(),
  personName: z.string().nullable().optional(),
  overdueHint: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
});

const bulletSchema = z.union([
  z.string(),
  z.object({
    text: z.string().optional(),
    evidence: z.string().nullable().optional(),
  }),
]);

const extractSchema = z.object({
  summary: z.string().optional(),
  summaryBullets: z.array(bulletSchema).optional(),
  languageMix: z.enum(["en", "hi", "hinglish"]),
  lane: z.enum(["life", "work"]).optional().default("work"),
  overwhelmed: z.boolean(),
  steps: z.array(kindItem),
  people: z.array(z.object({ name: z.string(), evidence: z.string().nullable().optional() })),
  openLoops: z.array(kindItem),
  commitments: z.array(kindItem).optional().default([]),
  decisions: z.array(kindItem).optional().default([]),
  ideas: z.array(kindItem).optional().default([]),
  questions: z.array(kindItem).optional().default([]),
});

const answerSchema = z.object({
  answer: z.string(),
  known: z.boolean(),
  citations: z.array(
    z.object({
      sessionId: z.string(),
      day: z.string(),
      quote: z.string(),
    }),
  ),
});

const nullable = { type: ["string", "null"] } as const;

const extractJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaryBullets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["text", "evidence"],
      },
    },
    languageMix: { type: "string", enum: ["en", "hi", "hinglish"] },
    lane: { type: "string", enum: ["life", "work"] },
    overwhelmed: { type: "boolean" },
    steps: { type: "array", items: stepSchema(true) },
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, evidence: { type: "string" } },
        required: ["name", "evidence"],
      },
    },
    openLoops: { type: "array", items: stepSchema(false) },
    commitments: { type: "array", items: stepSchema(false) },
    decisions: { type: "array", items: stepSchema(false) },
    ideas: { type: "array", items: stepSchema(false) },
    questions: { type: "array", items: stepSchema(false) },
  },
  required: [
    "summaryBullets",
    "languageMix",
    "lane",
    "overwhelmed",
    "steps",
    "people",
    "openLoops",
    "commitments",
    "decisions",
    "ideas",
    "questions",
  ],
} as const;

function stepSchema(withOverdue: boolean) {
  const properties: Record<string, unknown> = {
    title: { type: "string" },
    dueHint: nullable,
    personName: nullable,
    evidence: { type: "string" },
  };
  const required = ["title", "dueHint", "personName", "evidence"];
  if (withOverdue) {
    properties.overdueHint = nullable;
    required.push("overdueHint");
  }
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

const answerJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    known: { type: "boolean" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sessionId: { type: "string" },
          day: { type: "string" },
          quote: { type: "string" },
        },
        required: ["sessionId", "day", "quote"],
      },
    },
  },
  required: ["answer", "known", "citations"],
} as const;

type JsonFormat = {
  type: "json_schema";
  name: string;
  strict: true;
  schema: Record<string, unknown>;
};

type RespondBody = {
  model: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  temperature?: number;
  store?: boolean;
  reasoning?: { effort: "none" | "low" };
  text?: { format: JsonFormat };
};

function client() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export function modelName(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-6.1-sol";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isParamMismatch(err: unknown): boolean {
  const status = err && typeof err === "object" && "status" in err ? Number((err as { status: unknown }).status) : 0;
  if (status && status !== 400) return false;
  return /temperature|reasoning|unsupported|json_schema|response_format|text\.format|unknown parameter|\bstore\b/i.test(
    errorMessage(err),
  );
}

function reasoningFor(model: string): { effort: "none" | "low" } | undefined {
  if (/luna/i.test(model)) return { effort: "none" };
  if (/^gpt-[56]/.test(model) || /^o\d/.test(model)) return { effort: "low" };
  return undefined;
}

function without(body: RespondBody, keys: Array<keyof RespondBody>): RespondBody {
  const next = { ...body };
  for (const key of keys) delete next[key];
  return next;
}

async function respond(openai: OpenAI, body: RespondBody) {
  const reasoning = reasoningFor(body.model);
  const first = reasoning ? { ...body, reasoning } : body;
  const queue = [
    { ...first, store: false as const },
    without(first, ["reasoning", "store"]),
    without(first, ["reasoning", "temperature", "store"]),
    without(first, ["reasoning", "temperature", "text", "store"]),
  ];
  let last: unknown;
  for (let i = 0; i < queue.length; i++) {
    try {
      return await openai.responses.create(queue[i] as OpenAI.Responses.ResponseCreateParamsNonStreaming);
    } catch (err) {
      last = err;
      if (!isParamMismatch(err) || i === queue.length - 1) throw err;
    }
  }
  throw last;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```json\s*|```$/g, "").trim();
  return JSON.parse(trimmed);
}

function scrubArabic(extract: DumpExtract): DumpExtract {
  const blob = JSON.stringify(extract);
  if (!hasArabicScript(blob)) return extract;
  const summaryBullets = extract.summaryBullets.filter((line) => !hasArabicScript(line));
  const bullets = summaryBullets.length ? takeFive(summaryBullets) : ["I talked through a dump in Hindi."];
  const keep = <T extends { title: string }>(items: T[]) => items.filter((item) => !hasArabicScript(item.title));
  const steps = keep(extract.steps);
  const commitments = keep(extract.commitments);
  const openLoops = keep(extract.openLoops);
  const lane = steps.length + commitments.length + openLoops.length > 0 ? extract.lane : "life";
  return {
    ...extract,
    summaryBullets: bullets,
    summary: bulletsToSummary(bullets),
    steps,
    people: extract.people.filter((person) => !hasArabicScript(person.name)),
    openLoops,
    commitments,
    decisions: keep(extract.decisions),
    ideas: keep(extract.ideas),
    questions: keep(extract.questions),
    lane,
  };
}

export async function transcribeAudio(file: File): Promise<string> {
  const openai = client();
  if (!openai) return "";
  const result = await openai.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    prompt:
      "Indian English, Hindi, Hinglish. Write Hindi in Devanagari or Latin letters. Do not transcribe as Urdu. Never use Arabic script. Transcribe only what was spoken. Do not add words.",
  });
  return result.text?.trim() ?? "";
}

export async function companionReply(transcript: string, overwhelmed: boolean): Promise<string> {
  const safe = safeCompanionReply(overwhelmed);
  const openai = client();
  if (!openai) return safe;
  const model = modelName();
  try {
    const out = await respond(openai, {
      model,
      instructions: COMPANION_SYSTEM,
      input: `overwhelmed: ${overwhelmed ? "yes" : "no"}\n\ntranscript:\n${transcript.slice(0, 8000)}`,
      max_output_tokens: 2000,
      temperature: 0.3,
    });
    let text = out.output_text?.trim() || "";
    if (text && hasArabicScript(text)) {
      const retry = await respond(openai, {
        model,
        instructions: `${COMPANION_SYSTEM}\n\nYour last draft used Arabic/Urdu script. Rewrite in Hindi/Hinglish Latin or Devanagari, or English. No Arabic script. Do not add facts.`,
        input: `overwhelmed: ${overwhelmed ? "yes" : "no"}\n\ntranscript:\n${transcript.slice(0, 8000)}`,
        max_output_tokens: 2000,
        temperature: 0,
      });
      const fixed = retry.output_text?.trim() || "";
      if (fixed && !hasArabicScript(fixed)) text = fixed;
      else return safe;
    }
    return guardCompanionReply(text, transcript, overwhelmed);
  } catch {
    return safe;
  }
}

export async function extractDump(transcript: string): Promise<DumpExtract> {
  const openai = client();
  if (!openai) return groundDumpExtract({}, transcript);
  const model = modelName();
  try {
    const out = await respond(openai, {
      model,
      instructions: EXTRACT_SYSTEM,
      input: `transcript:\n${transcript.slice(0, 12000)}`,
      max_output_tokens: 8000,
      temperature: 0,
      text: {
        format: {
          type: "json_schema",
          name: "sayana_dump",
          strict: true,
          schema: extractJsonSchema as unknown as Record<string, unknown>,
        },
      },
    });
    const parsed = extractSchema.parse(parseJson(out.output_text?.trim() || ""));
    const raw: RawDump = parsed;
    return scrubArabic(groundDumpExtract(raw, transcript));
  } catch {
    return groundDumpExtract({}, transcript);
  }
}

export async function answerFromVault(question: string, sources: VaultSource[]): Promise<VaultAnswer> {
  const unknown: VaultAnswer = { answer: UNKNOWN_ANSWER, known: false, citations: [] };
  if (!sources.length) return unknown;
  const openai = client();
  if (!openai) {
    return {
      answer: "I can’t check that without an OpenAI key. The matching dumps are below.",
      known: false,
      citations: [],
    };
  }
  const packed = sources
    .map((source) => `[id=${source.id} day=${source.day}]\n${source.transcript.slice(0, 2500)}`)
    .join("\n\n")
    .slice(0, 14000);
  try {
    const out = await respond(openai, {
      model: modelName(),
      instructions: ASK_SYSTEM,
      input: `question:\n${question.slice(0, 500)}\n\nSOURCES:\n${packed}`,
      max_output_tokens: 4000,
      temperature: 0,
      text: {
        format: {
          type: "json_schema",
          name: "sayana_answer",
          strict: true,
          schema: answerJsonSchema as unknown as Record<string, unknown>,
        },
      },
    });
    const parsed = answerSchema.parse(parseJson(out.output_text?.trim() || ""));
    return groundVaultAnswer(parsed, sources);
  } catch {
    return unknown;
  }
}
