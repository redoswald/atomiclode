"use client";

import { useState } from "react";
import { glossNextBatch } from "@/app/actions/gloss";

export function GlossFiller({ remaining: initial, hasKey }: { remaining: number; hasKey: boolean }) {
  const [remaining, setRemaining] = useState(initial);
  const [running, setRunning] = useState(false);
  const [filled, setFilled] = useState(0);
  const [error, setError] = useState<string | undefined>();

  async function run() {
    setRunning(true);
    setError(undefined);
    let left = remaining;
    while (left > 0) {
      const r = await glossNextBatch();
      setFilled((n) => n + r.filled);
      setRemaining(r.remaining);
      left = r.remaining;
      if (r.error || r.filled === 0) {
        setError(r.error ?? "The model returned no glosses for this batch.");
        break;
      }
    }
    setRunning(false);
  }

  if (remaining === 0 && filled === 0) return null;

  return (
    <section className="card mt-6 p-5 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Glosses</h2>
          <p className="mt-1 text-muted">
            {remaining === 0
              ? `Done: ${filled} words glossed.`
              : `${remaining} words have no English meaning yet; new words can't be introduced until they do.`}
          </p>
        </div>
        {remaining > 0 && hasKey && (
          <button
            onClick={run}
            disabled={running}
            className="btn-primary shrink-0 text-sm"
          >
            {running ? `Filling… ${filled}` : "Fill glosses"}
          </button>
        )}
      </div>
      {!hasKey && remaining > 0 && (
        <p className="mt-2 text-muted">
          Set <code className="font-mono">ANTHROPIC_API_KEY</code> in Vercel and redeploy to enable this. About 75 short model
          requests.
        </p>
      )}
      {running && <p className="mt-2 text-muted">Keep this page open; each batch takes a few seconds.</p>}
      {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
