"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";

type SessionRow = {
  id: string;
  day: string;
  recordedAt: string;
  lane: string;
  wordCount?: number;
  curseCount?: number;
  preview?: string;
  transcript?: string;
};

type Citation = {
  sessionId: string;
  day: string;
  quote: string;
};

type AskResult = {
  answer: string;
  known: boolean;
  citations: Citation[];
};

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SessionRow[] | null>(null);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/history");
    const data = (await res.json()) as { sessions: SessionRow[] };
    setSessions(data.sessions || []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function openOne(id: string) {
    const res = await fetch(`/api/v1/history/${id}`);
    if (!res.ok) return;
    setOpen((await res.json()) as SessionRow);
  }

  async function ask() {
    const trimmed = q.trim();
    if (!trimmed || asking) return;
    setAsking(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: trimmed, tz }),
      });
      const data = (await res.json()) as AskResult & { sessions?: SessionRow[]; error?: string };
      setHits(data.sessions || []);
      setAnswer(
        res.ok
          ? {
              answer: data.answer || "I don't have that in your dumps.",
              known: Boolean(data.known),
              citations: data.citations || [],
            }
          : { answer: data.error || "I don't have that in your dumps.", known: false, citations: [] },
      );
      setOpen(null);
    } finally {
      setAsking(false);
    }
  }

  const list = hits ?? sessions;

  return (
    <main className="shell">
      <Nav current="history" />
      <h1>History</h1>
      <p className="quiet">Every rant, life and work. Ask what you said last Tuesday.</p>
      <section className="card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="what did I say last Tuesday…"
          onKeyDown={(e) => {
            if (e.key === "Enter") ask().catch(() => {});
          }}
        />
        <p>
          <button
            type="button"
            className="mic"
            style={{ width: "auto", height: "auto", padding: "8px 16px", marginTop: 10 }}
            disabled={asking}
            onClick={() => ask().catch(() => {})}
          >
            {asking ? "looking" : "ask"}
          </button>
          {hits ? (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginLeft: 8 }}
              onClick={() => {
                setHits(null);
                setAnswer(null);
              }}
            >
              all dumps
            </button>
          ) : null}
        </p>
      </section>
      {answer ? (
        <section className="card">
          <h2>From your dumps</h2>
          <p>{answer.answer}</p>
          {answer.citations.map((cite) => (
            <button
              type="button"
              className="cite"
              key={`${cite.sessionId}-${cite.quote.slice(0, 32)}`}
              onClick={() => openOne(cite.sessionId)}
            >
              <span className="cite-quote">“{cite.quote}”</span>
              <span className="quiet">{cite.day}</span>
            </button>
          ))}
        </section>
      ) : null}
      {open ? (
        <section className="card">
          <p className="quiet">
            {open.day} · {open.lane}
            <button type="button" className="ghost-btn" style={{ marginLeft: 8 }} onClick={() => setOpen(null)}>
              close
            </button>
          </p>
          <p className="transcript">{open.transcript}</p>
        </section>
      ) : null}
      {list.map((row) => (
        <button type="button" className="card history-row" key={row.id} onClick={() => openOne(row.id)}>
          <strong>
            {row.day} · {row.lane}
          </strong>
          <p className="quiet">{row.preview || row.transcript?.slice(0, 140) || "empty"}</p>
        </button>
      ))}
      {list.length === 0 ? (
        <p className="quiet">{hits ? "No dumps matched that." : "Nothing stored yet. Whatsup?"}</p>
      ) : null}
    </main>
  );
}
