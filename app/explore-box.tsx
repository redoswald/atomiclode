"use client";

import { useState } from "react";
import { ask } from "@/app/actions/explore";

/** "Explore": ask anything about French. Same model, no memory effect (SPEC §8). */
export function ExploreBox({ enabled }: { enabled: boolean }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const r = await ask(q);
    setAnswer(r.answer);
    setError(r.error);
    setBusy(false);
  }

  return (
    <section className="card mt-6 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl">Explore</h2>
        <span className="eyebrow">Ask anything about French</span>
      </div>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={enabled ? "Why is it « du pain » and not « de pain »?" : "Set ANTHROPIC_API_KEY to enable"}
          disabled={!enabled || busy}
          className="field min-w-0 flex-1 text-sm"
        />
        <button type="submit" disabled={!enabled || busy || !q.trim()} className="btn-primary shrink-0 text-sm">
          {busy ? "…" : "Ask"}
        </button>
      </form>
      {answer && <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{answer}</p>}
      {error && <p className="mt-3 text-sm text-muted">{error}</p>}
    </section>
  );
}
