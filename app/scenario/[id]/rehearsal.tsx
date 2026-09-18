"use client";

import { useState } from "react";
import { rehearse } from "@/app/actions/scenario";
import type { ProduceCheck } from "@/lib/review/produce";

export interface RehearsalPrompt {
  id: string;
  situation: string;
  exampleAnswer: string;
}

/** "Your turn": say it once now, with nothing at stake. The same prompts come back as graded cards weeks later. */
export function Rehearsal({ prompts }: { prompts: RehearsalPrompt[] }) {
  return (
    <ol className="mt-4 space-y-6">
      {prompts.map((p) => (
        <li key={p.id}>
          <One prompt={p} />
        </li>
      ))}
    </ol>
  );
}

function One({ prompt }: { prompt: RehearsalPrompt }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProduceCheck | { error: string } | undefined>();
  const verdict = result && !("error" in result) ? result : undefined;

  async function check() {
    if (!typed.trim() || busy) return;
    setBusy(true);
    setResult(await rehearse({ promptId: prompt.id, answer: typed }));
    setBusy(false);
  }

  return (
    <div>
      <p className="text-base leading-6">{prompt.situation}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="En français…"
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          lang="fr"
          className="field min-w-0 flex-1"
        />
        <button className="btn-secondary shrink-0 text-sm" disabled={busy || !typed.trim()}>
          {busy ? "…" : "Check"}
        </button>
      </form>
      {result && (
        <div className="mt-3 text-sm">
          {verdict ? (
            <>
              <p className={verdict.ok ? "text-ok" : "text-bad"}>{verdict.ok ? "That works" : "Not quite"}</p>
              {verdict.natural && verdict.natural !== typed.trim() && (
                <p className="font-display mt-1 text-xl" lang="fr">
                  {verdict.natural}
                </p>
              )}
              {verdict.note && <p className="mt-1 text-muted">{verdict.note}</p>}
            </>
          ) : (
            <p className="text-muted">{"error" in result ? result.error : ""}</p>
          )}
          <p className="mt-2 text-muted">
            One way to say it:{" "}
            <span className="text-ink" lang="fr">
              {prompt.exampleAnswer}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
