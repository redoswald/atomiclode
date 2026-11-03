"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { finishCheckpoint } from "@/app/actions/course";
import { sceneTurnDone } from "@/app/actions/progress";
import { rehearse } from "@/app/actions/scenario";
import { MicButton } from "@/app/components/mic";
import { LANG_SPECS, type Lang } from "@/lib/lang";
import type { ProduceCheck } from "@/lib/review/produce";

export interface RehearsalPrompt {
  id: string;
  situation: string;
  exampleAnswer: string;
}

/** "Your turn": say it once now, with nothing at stake. The same prompts come back as graded cards weeks later. */
export function Rehearsal({ prompts, lang = "fr", checkpointLessonId, visitId }: { prompts: RehearsalPrompt[]; lang?: Lang; checkpointLessonId?: string; visitId?: string }) {
  const [answered, setAnswered] = useState<string[]>([]);
  // Every "your turn" answered: the visit's XP (SPEC §18), once.
  useEffect(() => {
    if (visitId && prompts.length > 0 && answered.length === prompts.length) sceneTurnDone(visitId).catch(() => {});
  }, [answered.length, prompts.length, visitId]);
  return (
    <>
      <ol className="mt-4 space-y-6">
        {prompts.map((p) => (
          <li key={p.id}>
            <One prompt={p} lang={lang} onAnswered={() => setAnswered((a) => (a.includes(p.id) ? a : [...a, p.id]))} />
          </li>
        ))}
      </ol>
      {checkpointLessonId && <Checkpoint lessonId={checkpointLessonId} left={prompts.length - answered.length} />}
    </>
  );
}

/** This scene is the unit's checkpoint (SPEC §17): it passes once every "your turn" is answered. */
function Checkpoint({ lessonId, left }: { lessonId: string; left: number }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  async function finish() {
    setState("busy");
    const r = await finishCheckpoint(lessonId);
    setState("error" in r ? r.error : "done");
  }
  return (
    <div className="card mt-6 p-5 text-center">
      <p className="eyebrow">Checkpoint</p>
      {state === "done" ? (
        <>
          <p className="font-display mt-1 text-2xl">Unit passed</p>
          <Link href="/learn" className="btn-primary mt-3 inline-block">
            Back to the path
          </Link>
        </>
      ) : left > 0 ? (
        <p className="mt-1 text-sm text-muted">
          Answer {left === 1 ? "the last “your turn”" : `the ${left} “your turn” prompts`} above to pass this unit.
        </p>
      ) : (
        <>
          <button type="button" onClick={finish} disabled={state === "busy"} className="btn-primary mt-2 w-full">
            {state === "busy" ? "Saving…" : "Finish the checkpoint"}
          </button>
          {state !== "idle" && state !== "busy" && <p className="mt-2 text-sm text-bad">{state}</p>}
        </>
      )}
    </div>
  );
}

function One({ prompt, lang, onAnswered }: { prompt: RehearsalPrompt; lang: Lang; onAnswered: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProduceCheck | { error: string } | undefined>();
  const verdict = result && !("error" in result) ? result : undefined;

  async function check() {
    if (!typed.trim() || busy) return;
    setBusy(true);
    setResult(await rehearse({ promptId: prompt.id, answer: typed }));
    setBusy(false);
    onAnswered();
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
          placeholder={LANG_SPECS[lang].typePlaceholder}
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          lang={lang}
          className="field min-w-0 flex-1"
        />
        <MicButton lang={lang} onTranscript={(t) => setTyped((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />
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
                <p className="font-display mt-1 text-xl" lang={lang}>
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
            <span className="text-ink" lang={lang}>
              {prompt.exampleAnswer}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
