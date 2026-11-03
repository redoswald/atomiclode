"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkProduceAnswer, submitProduce, submitReview } from "@/app/actions/review";
import { MicButton } from "@/app/components/mic";
import { AutoplayToggle, playSpeech, prefetchSpeech, SpeakButton, stopSpeech, useSpeechSettings } from "@/app/components/speech";
import { WhyPanel } from "@/app/why-panel";
import type { Grade } from "@/lib/atoms/types";
import { LANG_SPECS, langName, type Lang } from "@/lib/lang";
import { LOOKALIKES, lookalikeMisread } from "@/lib/greek/script";
import { lenientMatch } from "@/lib/review/match";
import { displayKey } from "@/lib/atoms/display";
import { spokenText } from "@/lib/speech/say";
import type { ProduceCheck } from "@/lib/review/produce";
import type { BuiltSession, SessionCard } from "@/lib/review/session";

type Phase = "prompt" | "checking" | "revealed";

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

export function ReviewSession({ session, canWhy, onDone }: { session: BuiltSession; canWhy: boolean; onDone?: () => void }) {
  const { cards, plan, intensity } = session;
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [error, setError] = useState<string | undefined>();
  // Answers whose save failed (a network blip, an expired session). Kept and retried, never dropped.
  const unsaved = useRef<Array<() => Promise<unknown>>>([]);
  const [unsavedCount, setUnsavedCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const flushing = useRef(false);

  const card = cards[index];
  const { cloud } = useSpeechSettings();

  // Voice this card and the next while the learner is still thinking, so reveal plays at once.
  useEffect(() => {
    for (const c of [cards[index], cards[index + 1]]) if (c) prefetchSpeech(cloud, c.lang, cardSpeech(c));
  }, [cards, index, cloud]);

  /**
   * Run the queued saves in order, one loop at a time (a grade made while it runs is picked up
   * by it), and stop at the first failure so the review log keeps its order.
   */
  async function flush(): Promise<void> {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (unsaved.current.length) {
        try {
          await unsaved.current[0]();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        unsaved.current.shift();
        setUnsavedCount(unsaved.current.length);
      }
      setError(undefined);
    } finally {
      flushing.current = false;
      setUnsavedCount(unsaved.current.length);
    }
  }

  async function onGrade(grade: Grade, responseMs: number, usedAtomIds: string[] = []) {
    setOutcomes((o) => [...o, { card, grade }]);
    setIndex((i) => i + 1);
    const save =
      card.modality === "produce" && card.produce
        ? () => submitProduce({ atomId: card.atomId, promptId: card.produce!.promptId, grade, responseMs, usedAtomIds })
        : () => submitReview({ atomId: card.atomId, modality: card.modality, grade, responseMs, sentenceId: card.sentence?.id });
    unsaved.current.push(save);
    setUnsavedCount(unsaved.current.length);
    await flush();
  }

  async function retry() {
    setRetrying(true);
    await flush();
    setRetrying(false);
  }

  const fresh = outcomes.filter((o) => o.card.reason === "new").length;

  if (!card && onDone) {
    return <WarmupDone unsaved={unsavedCount} onDone={onDone} retry={retry} retrying={retrying} />;
  }

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
        {unsavedCount > 0 && (
          <div className="mt-3 flex items-baseline justify-between gap-3 text-sm text-bad">
            <span>
              {unsavedCount} {unsavedCount === 1 ? "answer isn't" : "answers aren't"} saved yet{error ? ` (${error})` : ""}.
            </span>
            <button type="button" onClick={retry} disabled={retrying} className="btn-secondary shrink-0">
              {retrying ? "Saving…" : "Retry"}
            </button>
          </div>
        )}
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
        <span className="flex items-baseline gap-3">
          <AutoplayToggle />
          <span>
            {outcomes.length} reviewed · {fresh} new
          </span>
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

/** End of a lesson's warm-up: straight on to the lesson once every answer is saved. */
function WarmupDone({ unsaved, onDone, retry, retrying }: { unsaved: number; onDone: () => void; retry: () => void; retrying: boolean }) {
  useEffect(() => {
    if (unsaved === 0) onDone();
  }, [unsaved, onDone]);
  return (
    <section className="card mt-5 p-5 text-center">
      <p className="text-sm text-muted">{unsaved ? `${unsaved} answers aren't saved yet.` : "Warm-up done."}</p>
      {unsaved > 0 && (
        <button type="button" onClick={retry} disabled={retrying} className="btn-secondary mt-3">
          {retrying ? "Saving…" : "Retry"}
        </button>
      )}
    </section>
  );
}

function CardView({ card, onGrade, canWhy }: { card: SessionCard; onGrade: (grade: Grade, responseMs: number, usedAtomIds?: string[]) => void; canWhy: boolean }) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [typed, setTyped] = useState("");
  const [correct, setCorrect] = useState<boolean | undefined>();
  const [check, setCheck] = useState<ProduceCheck | { error: string } | undefined>();
  const startedAt = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { cloud, autoplay } = useSpeechSettings();

  useEffect(() => {
    startedAt.current = Date.now();
    return () => stopSpeech();
  }, []);

  // Reveal is when a card speaks: never before, or a recall card would say its own answer.
  useEffect(() => {
    if (phase !== "revealed" || !autoplay) return;
    const text = cardSpeech(card);
    if (text) playSpeech(cloud, card.lang, text);
  }, [phase, autoplay, cloud, card]);

  const typedModality = card.modality === "recall" || card.modality === "cloze" || card.modality === "decode";
  const isProduce = card.modality === "produce" && card.produce !== undefined;
  const verdict = check && !("error" in check) ? check : undefined;
  const usedIt = verdict?.usedAtomIds.includes(card.atomId) ?? false;
  // Produce: understood and used the word is Good; one without the other is Hard; neither is Again.
  const suggested: Grade = isProduce ? (verdict ? (verdict.ok && usedIt ? 3 : verdict.ok || usedIt ? 2 : 1) : 3) : typedModality ? (correct ? 3 : 1) : 3;

  async function reveal() {
    if (phase !== "prompt") return;
    if (isProduce) {
      if (!typed.trim()) return;
      setPhase("checking");
      setCheck(await checkProduceAnswer({ promptId: card.produce!.promptId, answer: typed }));
      setPhase("revealed");
      return;
    }
    const opts = { lang: card.lang, romanizations: card.romanization ? [card.romanization] : [] };
    if (card.modality === "recall") setCorrect(lenientMatch(typed, [card.key, ...card.forms], opts));
    if (card.modality === "cloze") setCorrect(lenientMatch(typed, [card.cloze?.answer ?? card.key, ...card.forms], opts));
    // Decode is about the sound: only a Latin-letter reading counts, not the Greek copied back.
    if (card.modality === "decode") setCorrect(lenientMatch(typed, [], opts));
    setPhase("revealed");
  }

  function grade(g: Grade) {
    if (phase !== "revealed") return;
    onGrade(g, Date.now() - (startedAt.current ?? Date.now()), verdict?.usedAtomIds);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = document.activeElement === inputRef.current || document.activeElement instanceof HTMLTextAreaElement;
      if (phase === "checking") return;
      if (phase === "prompt") {
        if (e.key === "Enter" && e.shiftKey) return; // newline in a produce answer
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
    isProduce
      ? "What do you say?"
      : card.modality === "decode"
      ? "How does it sound?"
      : card.modality === "listen"
      ? "What do you hear?"
      : card.modality === "recall"
      ? `Translate to ${langName(card.lang)}`
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
        {isProduce ? (
          <ProducePrompt card={card} phase={phase} typed={typed} setTyped={setTyped} check={check} onSubmit={reveal} />
        ) : card.modality === "recall" ? (
          <RecallPrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
        ) : card.modality === "listen" ? (
          <ListenPrompt card={card} phase={phase} />
        ) : card.modality === "decode" ? (
          <DecodePrompt card={card} phase={phase} typed={typed} setTyped={setTyped} correct={correct} inputRef={inputRef} onSubmit={reveal} />
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
        {phase !== "revealed" ? (
          <button onClick={reveal} className="btn-primary w-full" disabled={phase === "checking" || (isProduce && !typed.trim())}>
            {phase === "checking" ? "Checking…" : typedModality || isProduce ? "Check" : "Show"}
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

/** The Latin-letter reading under a Greek card. */
function Romanized({ card }: { card: SessionCard }) {
  return card.romanization ? <p className="mt-1 text-base text-muted">{card.romanization}</p> : null;
}

function OtherForms({ card }: { card: SessionCard }) {
  const shown = displayKey(card);
  const others = card.forms.filter((f) => f !== card.key && !shown.includes(f)).slice(0, 6);
  return others.length ? (
    <p className="mt-2 text-sm text-muted" lang={card.lang}>
      {others.join(" · ")}
    </p>
  ) : null;
}

const CLOZE_PLACEHOLDER: Record<Lang, string> = { fr: "le mot manquant", el: "η λέξη που λείπει" };

/** What a card says on reveal: the word (with its article), or a cloze card's whole sentence. Produce cards stay quiet. */
function cardSpeech(card: SessionCard): string | undefined {
  if (card.modality === "produce") return undefined;
  if (card.modality === "cloze" && card.sentence) return card.sentence.text;
  return spokenText(card);
}

/** A word on a card with its play button beside it. */
function Spoken({ card, children, className = "" }: { card: SessionCard; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      {children}
      <SpeakButton lang={card.lang} text={cardSpeech(card)} />
    </div>
  );
}

function RecognizePrompt({ card, phase }: { card: SessionCard; phase: Phase }) {
  const word = (
    <p className="font-display text-4xl leading-tight" lang={card.type === "grammar" ? undefined : card.lang}>
      {card.type === "grammar" ? card.gloss : displayKey(card)}
    </p>
  );
  return (
    <div>
      {card.type === "grammar" ? <div className="mt-3">{word}</div> : <Spoken card={card} className="mt-3">{word}</Spoken>}
      {card.pos === "LETTER" && <Romanized card={card} />}
      {card.pos && card.type === "word" && <p className="mt-1 text-xs uppercase tracking-wide text-muted">{card.pos.toLowerCase()}</p>}
      {card.sentence && (
        <p className="mt-4 text-base text-muted" lang={card.lang}>
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
              {card.pos !== "LETTER" && <Romanized card={card} />}
              {card.pos === "LETTER" && <LookalikeNote card={card} />}
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

function AnswerInput({ card, phase, typed, setTyped, inputRef, onSubmit, placeholder, mic = false }: TypedProps & { placeholder: string; mic?: boolean }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="mt-6 flex items-start gap-2"
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
        lang={card.lang}
        className="field min-w-0 flex-1 text-center text-xl disabled:opacity-70"
      />
      {mic && phase !== "revealed" && <MicButton lang={card.lang} onTranscript={setTyped} />}
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
      <AnswerInput {...props} placeholder={LANG_SPECS[card.lang].typePlaceholder} mic />
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <Verdict correct={correct} />
          <Spoken card={card} className="mt-1">
            <p className="font-display text-3xl" lang={card.lang}>
              {displayKey(card)}
            </p>
          </Spoken>
          <Romanized card={card} />
          <OtherForms card={card} />
        </div>
      )}
    </div>
  );
}

/**
 * Listen (SPEC §15): sound only until reveal. It plays when the card appears,
 * whatever the auto-play setting, since sound is the whole card.
 */
function ListenPrompt({ card, phase }: { card: SessionCard; phase: Phase }) {
  const { cloud } = useSpeechSettings();
  const text = cardSpeech(card);
  // It starts playing as the card appears, so it starts in the playing state.
  const [playing, setPlaying] = useState<"normal" | "slow" | null>(text ? "normal" : null);

  const start = useCallback(
    (rate: "normal" | "slow") => {
      if (text) playSpeech(cloud, card.lang, text, { rate, onEnd: () => setPlaying(null) });
    },
    [cloud, card.lang, text],
  );
  const play = (rate: "normal" | "slow") => {
    if (!text) return;
    setPlaying(rate);
    start(rate);
  };

  useEffect(() => {
    start("normal");
  }, [start]);

  return (
    <div>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => play("normal")}
          aria-label="Play again"
          className={`flex h-20 w-20 items-center justify-center rounded-full border-2 ${playing === "normal" ? "border-sage bg-tint-sage" : "border-line bg-card"}`}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
          </svg>
        </button>
        <button type="button" onClick={() => play("slow")} className={`rounded-full border px-3 py-1.5 text-sm ${playing === "slow" ? "border-sage bg-tint-sage" : "border-line text-muted"}`}>
          Slow
        </button>
      </div>
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="font-display text-3xl" lang={card.lang}>
            {displayKey(card)}
          </p>
          <Romanized card={card} />
          <p className="mt-3 text-2xl">{card.gloss}</p>
          <OtherForms card={card} />
        </div>
      )}
    </div>
  );
}

/** "Looks like P. Says r." on a lookalike letter's card (SPEC §16). */
function LookalikeNote({ card }: { card: SessionCard }) {
  if (!card.domains?.includes("lookalike")) return null;
  const notes = card.forms.flatMap((f) => (LOOKALIKES[f] ? [`${f} looks like ${LOOKALIKES[f].looks}, says ${LOOKALIKES[f].says}`] : []));
  return notes.length ? <p className="mt-2 text-sm text-bad">{notes.join(" · ")}.</p> : null;
}

/** Greek script → sound (SPEC §16): see the word as written, type how it sounds in Latin letters. */
function DecodePrompt(props: TypedProps) {
  const { card, phase, typed, correct } = props;
  const shown = displayKey(card);
  const misread = phase === "revealed" && !correct && card.romanization ? lookalikeMisread(shown, typed, card.romanization) : undefined;
  return (
    <div>
      <p className="font-display mt-3 text-4xl leading-tight" lang={card.lang}>
        {shown}
      </p>
      <AnswerInput {...props} placeholder="In Latin letters: kafes" />
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <Verdict correct={correct} />
          <Spoken card={card} className="mt-1">
            <p className="text-3xl">{card.romanization}</p>
          </Spoken>
          {misread && (
            <p className="mt-2 text-sm text-bad">
              <span lang={card.lang}>{misread.letter}</span> looks like {misread.looks} but says {misread.says}.
            </p>
          )}
          <p className="mt-3 text-xl">{card.gloss}</p>
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
      <p className="font-display mt-3 text-2xl leading-9" lang={card.lang}>
        {c.before}
        <span className="mx-1 inline-block min-w-16 border-b-2 border-sage text-center">{phase === "revealed" ? c.answer : " "}</span>
        {c.after}
      </p>
      {card.gloss && <p className="mt-2 text-sm text-muted">{card.gloss}</p>}
      <AnswerInput {...props} placeholder={CLOZE_PLACEHOLDER[card.lang]} mic />
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5">
          <Verdict correct={correct} />
          <Spoken card={card} className="mt-1">
            <p className="font-display text-3xl" lang={card.lang}>
              {c.answer}
            </p>
          </Spoken>
          <Romanized card={card} />
          <p className="mt-1 text-sm text-muted">
            <span lang={card.lang}>{card.key}</span>
            {card.gloss ? ` · ${card.gloss}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function ProducePrompt({
  card,
  phase,
  typed,
  setTyped,
  check,
  onSubmit,
}: {
  card: SessionCard;
  phase: Phase;
  typed: string;
  setTyped: (s: string) => void;
  check?: ProduceCheck | { error: string };
  onSubmit: () => void;
}) {
  const p = card.produce!;
  const verdict = check && !("error" in check) ? check : undefined;
  return (
    <div>
      <p className="font-display mt-3 text-2xl leading-8">{p.situation}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mt-6"
      >
        <textarea
          autoFocus
          rows={3}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={phase !== "prompt"}
          placeholder={LANG_SPECS[card.lang].typePlaceholder}
          autoCapitalize="sentences"
          autoCorrect="off"
          spellCheck={false}
          lang={card.lang}
          className="field w-full resize-none text-lg disabled:opacity-70"
        />
        {phase === "prompt" && (
          <div className="mt-2 flex justify-end">
            <MicButton lang={card.lang} onTranscript={(t) => setTyped(typed.trim() ? `${typed.trim()} ${t}` : t)} />
          </div>
        )}
      </form>
      {phase === "revealed" && (
        <div className="mt-6 border-t border-line pt-5 text-left">
          {verdict ? (
            <>
              <p className={`text-sm ${verdict.ok ? "text-ok" : "text-bad"}`}>{verdict.ok ? "That works" : "Not quite"}</p>
              {verdict.natural && verdict.natural !== typed.trim() && (
                <p className="font-display mt-1 text-2xl leading-8" lang={card.lang}>
                  {verdict.natural}
                </p>
              )}
              {verdict.note && <p className="mt-2 text-sm text-muted">{verdict.note}</p>}
            </>
          ) : (
            <p className="text-sm text-bad">{check && "error" in check ? check.error : "Couldn't check that."} Grade yourself against the example.</p>
          )}
          <p className="eyebrow mt-4">One way to say it</p>
          <p className="mt-1 text-base" lang={card.lang}>
            {p.exampleAnswer}
          </p>
          <p className="mt-3 text-xs text-muted">
            {p.targets.map((t) => (
              <span key={t.atomId} className={`mr-3 ${verdict?.usedAtomIds.includes(t.atomId) ? "text-ok" : ""}`}>
                {verdict?.usedAtomIds.includes(t.atomId) ? "✓ " : ""}
                {t.key}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
