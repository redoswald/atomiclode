"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { submitReview } from "@/app/actions/review";
import type { Grade } from "@/lib/atoms/types";
import { lenientMatch } from "@/lib/review/match";
import type { BuiltSession, SessionCard } from "@/lib/review/session";

type Phase = "prompt" | "revealed";

interface Outcome {
  card: SessionCard;
  grade: Grade;
}

const GRADES: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: 1, label: "Again", key: "1" },
  { grade: 2, label: "Hard", key: "2" },
  { grade: 3, label: "Good", key: "3" },
  { grade: 4, label: "Easy", key: "4" },
];

export function ReviewSession({ session }: { session: BuiltSession }) {
  const { cards, plan, intensity } = session;
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [error, setError] = useState<string | undefined>();

  const card = cards[index];

  async function onGrade(grade: Grade, responseMs: number) {
    setOutcomes((o) => [...o, { card, grade }]);
    setIndex((i) => i + 1);
    try {
      await submitReview({ atomId: card.atomId, modality: card.modality, grade, responseMs, sentenceId: card.sentence?.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!card) {
    const reviewed = outcomes.length;
    const fresh = outcomes.filter((o) => o.card.reason === "new").length;
    const again = outcomes.filter((o) => o.grade === 1).length;
    return (
      <div className="flex flex-1 flex-col">
        <h1 className="text-lg font-medium">Session done</h1>
        <p className="mt-2 text-sm">
          {reviewed} reviewed · {fresh} new{plan.deferred > 0 && ` · ${plan.deferred} deferred`}
          {plan.skipped > 0 && ` · ${plan.skipped} didn't fit`}
        </p>
        <p className="mt-1 text-sm text-muted">{again === 0 ? "Nothing missed." : `${again} to see again soon.`}</p>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">Some answers failed to save: {error}</p>}
        <div className="mt-8 flex gap-4 text-sm">
          <Link href={`/review?intensity=${intensity}`} className="underline">
            Continue
          </Link>
          <Link href="/" className="underline">
            Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>
          {index + 1} / {cards.length}
        </span>
        <span>
          {card.reason} · {card.modality}
        </span>
      </div>
      {/* Keyed by index so every card starts with fresh local state. */}
      <CardView key={index} card={card} onGrade={onGrade} />
      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function CardView({ card, onGrade }: { card: SessionCard; onGrade: (grade: Grade, responseMs: number) => void }) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | undefined>();
  const [showWhy, setShowWhy] = useState(false);
  const startedAt = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const typedModality = card.modality === "recall" || card.modality === "cloze";
  const suggested: Grade = typedModality ? (correct ? 3 : 1) : 3;

  function reveal() {
    if (phase !== "prompt") return;
    if (card.modality === "recall") setCorrect(lenientMatch(typed, [card.key, ...card.forms]));
    if (card.modality === "cloze") setCorrect(lenientMatch(typed, [card.cloze?.answer ?? card.key, ...card.forms]));
    setPhase("revealed");
  }

  function grade(g: Grade) {
    if (phase !== "revealed") return;
    onGrade(g, Date.now() - (startedAt.current ?? Date.now()));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = document.activeElement === inputRef.current;
      if (phase === "prompt") {
        if (e.key === "Enter" || (e.key === " " && !typing)) {
          e.preventDefault();
          reveal();
        }
        return;
      }
      const g = GRADES.find((x) => x.key === e.key);
      if (g) {
        e.preventDefault();
        grade(g.grade);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        grade(suggested);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="mt-10 flex-1">
        {card.modality === "recall" ? (
          <RecallPrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
        ) : card.modality === "cloze" && card.cloze ? (
          <ClozePrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
        ) : (
          <RecognizePrompt card={card} phase={phase} />
        )}

        {phase === "revealed" && card.explanation && card.type !== "grammar" && (
          <div className="mt-6 text-sm">
            <button onClick={() => setShowWhy((v) => !v)} className="text-muted underline">
              Why?
            </button>
            {showWhy && <p className="mt-2 leading-6">{card.explanation}</p>}
          </div>
        )}
      </div>

      <div className="mt-8">
        {phase === "prompt" ? (
          <button onClick={reveal} className="w-full rounded-md bg-foreground py-3 text-background">
            {typedModality ? "Check" : "Show"}
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.grade}
                onClick={() => grade(g.grade)}
                className={`rounded-md border py-3 text-sm ${g.grade === suggested ? "border-foreground" : "border-line text-muted"}`}
              >
                {g.label}
                <span className="ml-1 hidden text-xs text-muted sm:inline">{g.key}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function displayKey(card: SessionCard): string {
  if (card.type === "word" && card.pos === "NOUN" && card.gender) {
    const vowel = /^[aeiouyâàéèêëîïôöûüœ]/i.test(card.key);
    return `${vowel ? "l'" : card.gender === "m" ? "le " : "la "}${card.key}`;
  }
  return card.key;
}

function OtherForms({ card }: { card: SessionCard }) {
  const others = card.forms.filter((f) => f !== card.key).slice(0, 6);
  return others.length ? <p className="mt-2 text-sm text-muted">{others.join(" · ")}</p> : null;
}

function RecognizePrompt({ card, phase }: { card: SessionCard; phase: Phase }) {
  const label = card.type === "grammar" ? "grammar" : card.type === "chunk" ? "phrase" : card.pos?.toLowerCase();
  return (
    <div>
      {label && <p className="text-xs uppercase tracking-wide text-muted">{label}</p>}
      <p className="mt-1 text-3xl">{card.type === "grammar" ? card.gloss : displayKey(card)}</p>
      {card.sentence && <p className="mt-4 text-lg text-muted">{card.sentence.text}</p>}
      {phase === "revealed" && (
        <div className="mt-8 border-t border-line pt-6">
          {card.type === "grammar" ? (
            <p className="leading-6">{card.explanation ?? "No explanation yet."}</p>
          ) : (
            <>
              <p className="text-2xl">{card.gloss || <span className="text-muted">no gloss yet</span>}</p>
              <OtherForms card={card} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RecallPrompt({
  card,
  phase,
  typed,
  setTyped,
  correct,
  inputRef,
  onSubmit,
}: {
  card: SessionCard;
  phase: Phase;
  typed: string;
  setTyped: (s: string) => void;
  correct?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
}) {
  return (
    <div>
      {card.pos && (
        <p className="text-xs uppercase tracking-wide text-muted">
          {card.pos.toLowerCase()}
          {card.gender ? ` · ${card.gender}` : ""}
        </p>
      )}
      <p className="mt-1 text-3xl">{card.gloss}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mt-6"
      >
        <input
          ref={inputRef}
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={phase === "revealed"}
          placeholder="en français"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang="fr"
          className="w-full rounded-md border border-line bg-transparent px-3 py-2 text-xl outline-none focus:border-foreground disabled:opacity-70"
        />
      </form>
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-6">
          <p className={`text-sm ${correct ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {correct ? "Correct" : "Not quite"}
          </p>
          <p className="mt-1 text-2xl">{displayKey(card)}</p>
          <OtherForms card={card} />
        </div>
      )}
    </div>
  );
}

function ClozePrompt({
  card,
  phase,
  typed,
  setTyped,
  correct,
  inputRef,
  onSubmit,
}: {
  card: SessionCard;
  phase: Phase;
  typed: string;
  setTyped: (s: string) => void;
  correct?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
}) {
  const c = card.cloze!;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">fill the gap</p>
      <p className="mt-1 text-xl leading-8" lang="fr">
        {c.before}
        <span className="mx-1 inline-block min-w-16 border-b border-foreground text-center">
          {phase === "revealed" ? c.answer : "\u00a0"}
        </span>
        {c.after}
      </p>
      {card.gloss && <p className="mt-2 text-sm text-muted">{card.gloss}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mt-6"
      >
        <input
          ref={inputRef}
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={phase === "revealed"}
          placeholder="le mot manquant"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang="fr"
          className="w-full rounded-md border border-line bg-transparent px-3 py-2 text-xl outline-none focus:border-foreground disabled:opacity-70"
        />
      </form>
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-6">
          <p className={`text-sm ${correct ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {correct ? "Correct" : "Not quite"}
          </p>
          <p className="mt-1 text-2xl">{c.answer}</p>
          <p className="mt-1 text-sm text-muted">
            {card.key}
            {card.gloss ? ` · ${card.gloss}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
