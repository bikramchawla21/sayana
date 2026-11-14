import { NextResponse } from "next/server";
import { requirePerson } from "@/server/auth";
import { answerFromVault } from "@/server/openai";
import { getSql } from "@/db/client";
import { dayHintsFromQuery } from "@/domain/day-hint";
import { rankVaultSessions, UNKNOWN_ANSWER, type VaultSource } from "@/domain/grounding";

export const runtime = "nodejs";
export const maxDuration = 30;

type SessionRow = VaultSource & {
  recordedAt: string;
  lane: string;
};

export async function POST(request: Request) {
  const person = await requirePerson();
  const body = (await request.json()) as { q?: string; tz?: string };
  const q = (body.q || "").trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
  const timeZone = body.tz || "UTC";
  const days = dayHintsFromQuery(q, new Date(), timeZone);
  const loaded = await loadSessions(person.id, days);
  const pool = loaded
    .map((row) =>
      mapSession(
        row as {
          id?: unknown;
          local_day?: unknown;
          recorded_at?: unknown;
          dump_lane?: unknown;
          transcript?: unknown;
        },
      ),
    )
    .filter((row) => row.transcript.trim());
  const ranked = rankVaultSessions(q, pool, 8);
  const chosen = ranked.length ? ranked : days.length ? pool.slice(0, 8) : [];
  const grounded = chosen.length
    ? await answerFromVault(q, chosen)
    : { answer: UNKNOWN_ANSWER, known: false, citations: [] };

  return NextResponse.json({
    q,
    days,
    answer: grounded.answer,
    known: grounded.known,
    citations: grounded.citations,
    sessions: chosen.map((row) => ({
      id: row.id,
      day: row.day,
      recordedAt: row.recordedAt,
      lane: row.lane,
      transcript: row.transcript,
      preview: row.transcript.slice(0, 280),
    })),
  });
}

function mapSession(row: {
  id?: unknown;
  local_day?: unknown;
  recorded_at?: unknown;
  dump_lane?: unknown;
  transcript?: unknown;
}): SessionRow {
  return {
    id: String(row.id),
    day: String(row.local_day),
    recordedAt: row.recorded_at ? String(row.recorded_at) : "",
    lane: String(row.dump_lane || "work"),
    transcript: String(row.transcript || ""),
  };
}

async function loadSessions(personId: string, days: string[]) {
  const db = getSql();
  if (days.length) {
    const merged = [];
    for (const day of days.slice(0, 4)) {
      const rows = await db`
        SELECT id, local_day, recorded_at, dump_lane, transcript
        FROM sayana_sessions
        WHERE person_id = ${personId} AND local_day = ${day}
        ORDER BY recorded_at DESC
        LIMIT 12
      `;
      merged.push(...(Array.isArray(rows) ? rows : []));
    }
    return merged;
  }
  const rows = await db`
    SELECT id, local_day, recorded_at, dump_lane, transcript
    FROM sayana_sessions
    WHERE person_id = ${personId}
    ORDER BY recorded_at DESC
    LIMIT 60
  `;
  return Array.isArray(rows) ? rows : [];
}
