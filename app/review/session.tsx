"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { submitReview } from "@/app/actions/review";
import { WhyPanel } from "@/app/why-panel";
import type { Grade } from "@/lib/atoms/types";
import { lenientMatch } from "@/lib/review/match";
import type { BuiltSession, SessionCard } from "@/lib/review/session";

type Phase = "prompt" | "revealed";

interface Outcome {
  card: SessionCard;
  grade: Grade;
}

const GRADES: Array<{ grade: Grade; label: string; hint: string; key: string; tint: string }> = [
  { grade: 1, label: "Again", hint: "I don't recall", key: "1", tint: "bg-tint-rose" },
  { grade: 2, label: "Hard", hint: "Still tricky", key: "2", tint: "bg-tint-sand" },
  { grade: 3, label: "Good", hint: "Mostly right", key: "3", tint: "bg-tint-sage" },
  { grade: 4, label: "Easy", hint: "Felt easy", key: "4", tint: "bg-tint-moss" },
];

export function ReviewSession({ session, canWhy }: { session: BuiltSession; canWhy: boolean }) {
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

  const fresh = outcomes.filter((o) => o.card.reason === "new").length;

  if (!card) {
    const reviewed = outcomes.length;
    const again = outcomes.filter((o) => o.grade === 1).length;
    return (
      <section className="card p-5">
        <h2 className="font-display text-2xl">Session done</h2>
        <p className="mt-2 text-sm">
          {reviewed} reviewed · {fresh} new{plan.deferred > 0 && ` · ${plan.deferred} deferred`}
          {plan.skipped > 0 && ` · ${plan.skipped} didn't fit`}
        </p>
        <p className="mt-1 text-sm text-muted">{again === 0 ? "Nothing missed." : `${again} to see again soon.`}</p>
        {error && <p className="mt-3 text-sm text-bad">Some answers failed to save: {error}</p>}
        <div className="mt-6 flex gap-2 text-sm">
          <Link href={`/review?intensity=${intensity}`} className="btn-primary">
            Continue
          </Link>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>
          Item {index + 1} of {cards.length}
        </span>
        <span>
          {outcomes.length} reviewed · {fresh} new
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-sage transition-[width]" style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>
      {/* Keyed by index so every card starts with fresh local state. */}
      <CardView key={index} card={card} onGrade={onGrade} canWhy={canWhy} />
      {error && <p className="mt-3 text-xs text-bad">{error}</p>}
    </div>
  );
}

function CardView({ card, onGrade, canWhy }: { card: SessionCard; onGrade: (grade: Grade, responseMs: number) => void; canWhy: boolean }) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | undefined>();
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

  const label =
    card.modality === "recall"
      ? "Translate to French"
      : card.modality === "cloze"
        ? "Fill the gap"
        : card.type === "grammar"
          ? "Grammar idea"
          : card.type === "chunk"
            ? "Phrase"
            : "What does it mean?";

  return (
    <>
      <section className="card mt-5 min-h-64 p-5 text-center">
        <p className="text-sm text-muted">{label}</p>
        {card.modality === "recall" ? (
          <RecallPrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
        ) : card.modality === "cloze" && card.cloze ? (
          <ClozePrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
        ) : (
          <RecognizePrompt card={card} phase={phase} />
        )}
        {phase === "revealed" && card.type !== "grammar" && (
          <WhyPanel request={{ atomId: card.atomId, sentence: card.sentence?.text }} cached={card.sentence ? undefined : card.explanation} canWhy={canWhy} className="mt-5 text-left" />
        )}
      </section>

      <div className="mt-4">
        {phase === "prompt" ? (
          <button onClick={reveal} className="btn-primary w-full">
            {typedModality ? "Check" : "Show"}
          </button>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {GRADES.map((g) => (
              <button
                key={g.grade}
                onClick={() => grade(g.grade)}
                className={`rounded-2xl ${g.tint} px-1 py-3 text-ink ${g.grade === suggested ? "ring-2 ring-sage" : ""}`}
              >
                <span className="font-display block text-lg">{g.label}</span>
                <span className="block text-[11px] text-muted">{g.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {card.insight && (
        <p className="card mt-4 px-4 py-3 text-sm italic text-muted">{card.insight}</p>
      )}
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
  return (
    <div>
      <p className="font-display mt-3 text-4xl leading-tight">{card.type === "grammar" ? card.gloss : displayKey(card)}</p>
      {card.pos && card.type === "word" && <p className="mt-1 text-xs uppercase tracking-wide text-muted">{card.pos.toLowerCase()}</p>}
      {card.sentence && (
        <p className="mt-4 text-base text-muted" lang="fr">
          {card.sentence.text}
        </p>
      )}
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          {card.type === "grammar" ? (
            <p className="text-left text-sm leading-6">{card.explanation ?? "No explanation yet."}</p>
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

interface TypedProps {
  card: SessionCard;
  phase: Phase;
  typed: string;
  setTyped: (s: string) => void;
  correct?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
}

function AnswerInput({ phase, typed, setTyped, inputRef, onSubmit, placeholder }: TypedProps & { placeholder: string }) {
  return (
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
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        lang="fr"
        className="field w-full text-center text-xl disabled:opacity-70"
      />
    </form>
  );
}

function Verdict({ correct }: { correct?: boolean }) {
  return <p className={`text-sm ${correct ? "text-ok" : "text-bad"}`}>{correct ? "Correct" : "Not quite"}</p>;
}

function RecallPrompt(props: TypedProps) {
  const { card, phase, correct } = props;
  return (
    <div>
      <p className="font-display mt-3 text-4xl leading-tight">{card.gloss}</p>
      {card.pos && (
        <p className="mt-1 text-xs uppercase tracking-wide text-muted">
          {card.pos.toLowerCase()}
          {card.gender ? ` · ${card.gender}` : ""}
        </p>
      )}
      <AnswerInput {...props} placeholder="Type your answer in French…" />
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <Verdict correct={correct} />
          <p className="font-display mt-1 text-3xl">{displayKey(card)}</p>
          <OtherForms card={card} />
        </div>
      )}
    </div>
  );
}

function ClozePrompt(props: TypedProps) {
  const { card, phase, correct } = props;
  const c = card.cloze!;
  return (
    <div>
      <p className="font-display mt-3 text-2xl leading-9" lang="fr">
        {c.before}
        <span className="mx-1 inline-block min-w-16 border-b-2 border-sage text-center">{phase === "revealed" ? c.answer : " "}</span>
        {c.after}
      </p>
      {card.gloss && <p className="mt-2 text-sm text-muted">{card.gloss}</p>}
      <AnswerInput {...props} placeholder="le mot manquant" />
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <Verdict correct={correct} />
          <p className="font-display mt-1 text-3xl">{c.answer}</p>
          <p className="mt-1 text-sm text-muted">
            {card.key}
            {card.gloss ? ` · ${card.gloss}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
