"use client";

/**
 * The lesson player (SPEC §17): warm-up, Meet, Practice, Done. Practice
 * requeues a missed exercise at the end; the lesson is done when every
 * exercise has been answered right once. Only Done touches the server.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { finishLesson } from "@/app/actions/course";
import { MicButton } from "@/app/components/mic";
import { playSpeech, SpeakButton, stopSpeech, useSpeechSettings } from "@/app/components/speech";
import { ReviewSession } from "@/app/review/session";
import type { Exercise, ItemStats, LessonItemView } from "@/lib/course/exercises";
import type { LessonPayload, LessonResult } from "@/lib/course/lesson";
import { lookalikeMisread } from "@/lib/greek/script";
import { lenientMatch } from "@/lib/review/match";
import type { BuiltSession } from "@/lib/review/session";
import { LETTER_SAY } from "@/lib/speech/say";

type Stage = "warmup" | "meet" | "practice" | "done";

export function LessonPlayer({ lesson, warmup, canWhy }: { lesson: LessonPayload; warmup?: BuiltSession; canWhy: boolean }) {
  const [stage, setStage] = useState<Stage>(warmup ? "warmup" : "meet");
  const [stats, setStats] = useState<Record<string, ItemStats>>({});
  const byId = useMemo(() => new Map([...lesson.items, ...lesson.recent].map((i) => [i.atomId, i])), [lesson]);

  return (
    <div className="flex flex-1 flex-col">
      <header>
        <p className="eyebrow">
          {lesson.unitTitle} · lesson {lesson.n} of {lesson.total}
          {lesson.replay ? " · replay" : ""}
        </p>
        <h1 className="font-display mt-1 text-3xl leading-tight">{lesson.title}</h1>
        <Steps stage={stage} hasWarmup={Boolean(warmup)} />
      </header>
      {stage === "warmup" && warmup && (
        <div className="mt-2">
          <p className="mt-3 text-sm text-muted">A quick warm-up: a few reviews that are due, then the lesson.</p>
          <ReviewSession session={warmup} canWhy={canWhy} onDone={() => setStage("meet")} />
        </div>
      )}
      {stage === "meet" && <Meet items={lesson.items} onDone={() => setStage("practice")} />}
      {stage === "practice" && (
        <Practice
          exercises={lesson.exercises}
          byId={byId}
          onDone={(s) => {
            setStats(s);
            setStage("done");
          }}
        />
      )}
      {stage === "done" && <Done lesson={lesson} stats={stats} />}
    </div>
  );
}

function Steps({ stage, hasWarmup }: { stage: Stage; hasWarmup: boolean }) {
  const all: Array<[Stage, string]> = [...(hasWarmup ? ([["warmup", "Warm-up"]] as Array<[Stage, string]>) : []), ["meet", "Meet"], ["practice", "Practice"], ["done", "Done"]];
  const at = all.findIndex(([s]) => s === stage);
  return (
    <ol className="mt-3 flex gap-1.5" aria-label="Lesson steps">
      {all.map(([s, label], i) => (
        <li key={s} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= at ? "bg-sage" : "bg-line"}`} />
          <span className={`mt-1 block text-[11px] ${i === at ? "text-ink" : "text-muted"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

// ---- Meet ----------------------------------------------------------------------

function Meet({ items, onDone }: { items: LessonItemView[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const { cloud } = useSpeechSettings();
  const item = items[i];
  const say = item?.isLetter ? LETTER_SAY[item.key] : item?.speak;

  useEffect(() => {
    if (say && item) playSpeech(cloud, item.lang, say);
    return () => stopSpeech();
  }, [say, item, cloud]);

  if (!item) return null;
  const next = () => (i + 1 < items.length ? setI(i + 1) : onDone());
  return (
    <section className="mt-5 flex flex-1 flex-col">
      <p className="text-xs text-muted">
        New {item.isLetter ? "letter" : item.type === "chunk" ? "phrase" : "word"} · {i + 1} of {items.length}
      </p>
      <div className="card mt-2 p-6 text-center">
        <div className="flex items-center justify-center gap-3">
          <p className="font-display text-5xl leading-tight" lang={item.lang}>
            {item.display}
          </p>
          <SpeakButton lang={item.lang} text={say} />
        </div>
        {!item.isLetter && item.romanization && <p className="mt-2 text-lg text-muted">{item.romanization}</p>}
        <p className="mt-4 text-2xl">{item.gloss}</p>
        {item.lookalike && <p className="mt-3 text-sm text-bad">{item.lookalike}.</p>}
        {item.mode === "sight" && <p className="mt-3 text-sm text-muted">Its spelling doesn&apos;t follow the rules yet: just learn how it sounds.</p>}
        {item.mode === "heard" && !item.decodable && <p className="mt-3 text-sm text-muted">You&apos;ll be able to read this soon. For now, listen and say it.</p>}
        {item.known && <p className="mt-3 text-xs text-muted">You&apos;ve met this one before; it stays in your reviews as it is.</p>}
        {item.example && (
          <div className="mt-5 border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-center gap-2">
              <span lang={item.lang}>{item.example.text}</span>
              <SpeakButton lang={item.lang} text={item.example.text} label="Play the phrase" />
            </div>
            <p className="mt-1 text-muted">{item.example.gloss}</p>
          </div>
        )}
      </div>
      <button type="button" onClick={next} className="btn-primary mt-4 w-full">
        {i + 1 < items.length ? "Next" : "Practise"}
      </button>
    </section>
  );
}

// ---- Practice ----------------------------------------------------------------------

/** Items an exercise is about, for the per-item stats. */
function itemsOf(e: Exercise): string[] {
  if (e.kind === "pairs") return e.items;
  if (e.kind === "sound") return [e.letter];
  return [e.item];
}

function Practice({ exercises, byId, onDone }: { exercises: Exercise[]; byId: Map<string, LessonItemView>; onDone: (stats: Record<string, ItemStats>) => void }) {
  const [queue, setQueue] = useState<Exercise[]>(exercises);
  const [noSpeaking, setNoSpeaking] = useState(false);
  const stats = useRef<Record<string, ItemStats>>({});
  const total = exercises.length;
  const remaining = queue.length;

  // "Can't speak now" drops speaking from the rest of the lesson.
  const current = queue.find((e) => !(noSpeaking && e.kind === "say"));

  useEffect(() => {
    if (!current) onDone(stats.current);
  }, [current, onDone]);

  function record(ids: string[], right: boolean) {
    for (const id of ids) {
      const s = stats.current[id] ?? { attempts: 0, misses: 0, firstTimeRight: true };
      stats.current[id] = { attempts: s.attempts + 1, misses: s.misses + (right ? 0 : 1), firstTimeRight: s.firstTimeRight && right };
    }
  }

  function answered(right: boolean, missedIds?: string[]) {
    if (!current) return;
    if (missedIds) {
      record(itemsOf(current).filter((id) => !missedIds.includes(id)), true);
      record(missedIds, false);
    } else record(itemsOf(current), right);
    setQueue((q) => {
      const rest = q.filter((e) => e !== current);
      return right ? rest : [...rest, current];
    });
  }

  if (!current) return null;
  const doneCount = total - remaining;
  return (
    <section className="mt-5 flex flex-1 flex-col">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>
          {doneCount} of {total}
        </span>
        {current.kind === "say" && (
          <button type="button" className="underline" onClick={() => setNoSpeaking(true)}>
            Can&apos;t speak now
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-sage transition-[width]" style={{ width: `${(doneCount / total) * 100}%` }} />
      </div>
      <ExerciseView key={`${queue.indexOf(current)}-${remaining}`} ex={current} byId={byId} onAnswer={answered} />
    </section>
  );
}

type Answer = (right: boolean, missedIds?: string[]) => void;

function ExerciseView({ ex, byId, onAnswer }: { ex: Exercise; byId: Map<string, LessonItemView>; onAnswer: Answer }) {
  switch (ex.kind) {
    case "meaning":
      return <Choice ex={ex} item={byId.get(ex.item)!} onAnswer={onAnswer} />;
    case "hear":
      return <Choice ex={ex} item={byId.get(ex.item)!} onAnswer={onAnswer} />;
    case "sound":
      return <Choice ex={ex} item={byId.get(ex.letter)!} onAnswer={onAnswer} />;
    case "decode":
      return <Typed mode="decode" item={byId.get(ex.item)!} onAnswer={onAnswer} />;
    case "say":
      return <Typed mode="say" item={byId.get(ex.item)!} onAnswer={onAnswer} />;
    case "build":
      return <Build tiles={ex.tiles} item={byId.get(ex.item)!} onAnswer={onAnswer} />;
    case "pairs":
      return <Pairs items={ex.items.map((id) => byId.get(id)!).filter(Boolean)} onAnswer={onAnswer} />;
  }
}

/** After an answer: right or wrong, the answer shown, and Continue. */
function Feedback({ right, children, onContinue }: { right: boolean; children?: React.ReactNode; onContinue: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className={`mt-4 rounded-2xl p-4 ${right ? "bg-tint-sage" : "bg-tint-rose"}`}>
      <p className={`font-medium ${right ? "text-ok" : "text-bad"}`}>{right ? "Right" : "Not quite. It'll come back at the end."}</p>
      {children}
      <button ref={ref} type="button" onClick={onContinue} className="btn-primary mt-3 w-full">
        Continue
      </button>
    </div>
  );
}

function Choice({ ex, item, onAnswer }: { ex: Extract<Exercise, { kind: "meaning" | "hear" | "sound" }>; item: LessonItemView; onAnswer: Answer }) {
  const { cloud } = useSpeechSettings();
  const [picked, setPicked] = useState<number | null>(null);
  const say = ex.kind === "sound" ? LETTER_SAY[item.key] : item.speak;

  useEffect(() => {
    if (ex.kind !== "meaning" && say) playSpeech(cloud, item.lang, say);
    return () => stopSpeech();
  }, [ex.kind, say, item.lang, cloud]);

  const right = picked === ex.answer;
  const prompt =
    ex.kind === "meaning" ? "What does it mean?" : ex.kind === "hear" ? "Which one do you hear?" : `Which word has the sound of ${item.display}?`;
  return (
    <div className="card mt-4 p-5 text-center">
      <p className="text-sm text-muted">{prompt}</p>
      <div className="mt-3 flex items-center justify-center gap-3">
        {ex.kind === "hear" ? null : (
          <p className="font-display text-4xl" lang={item.lang}>
            {item.display}
          </p>
        )}
        <SpeakButton lang={item.lang} text={say} />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ex.options.map((o, i) => (
          <button
            key={o + i}
            type="button"
            disabled={picked !== null}
            onClick={() => setPicked(i)}
            lang={ex.kind === "meaning" ? undefined : item.lang}
            className={`rounded-2xl border px-3 py-3 text-lg ${
              picked === null ? "border-line bg-card" : i === ex.answer ? "border-ok bg-tint-sage" : i === picked ? "border-bad bg-tint-rose" : "border-line bg-card opacity-60"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      {picked !== null && (
        <Feedback right={right} onContinue={() => onAnswer(right)}>
          {ex.kind !== "meaning" && <p className="mt-1 text-sm" lang={item.lang}>{ex.kind === "sound" ? `${ex.options[ex.answer]} has ${item.display}` : `${item.display} · ${item.gloss}`}</p>}
        </Feedback>
      )}
    </div>
  );
}

/** Sound it out (type the Latin reading) or say it (speak, transcribed). */
function Typed({ mode, item, onAnswer }: { mode: "decode" | "say"; item: LessonItemView; onAnswer: Answer }) {
  const { cloud } = useSpeechSettings();
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<boolean | null>(null);
  const romanizations = item.romanization ? [item.romanization] : [];

  function check(text = typed) {
    if (!text.trim() || checked !== null) return;
    const ok = mode === "decode" ? lenientMatch(text, [], { lang: item.lang, romanizations }) : lenientMatch(text, [item.key], { lang: item.lang, romanizations });
    setChecked(ok);
    if (item.speak) playSpeech(cloud, item.lang, item.speak);
  }

  const misread = checked === false && mode === "decode" && item.romanization ? lookalikeMisread(item.display, typed, item.romanization) : undefined;
  return (
    <div className="card mt-4 p-5 text-center">
      <p className="text-sm text-muted">{mode === "decode" ? "How does it sound? Type it in Latin letters." : "Say it in Greek."}</p>
      <p className={`mt-3 ${mode === "decode" ? "font-display text-4xl" : "text-2xl"}`} lang={mode === "decode" ? item.lang : undefined}>
        {mode === "decode" ? item.display : item.gloss}
      </p>
      <form
        className="mt-5 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <input
          autoFocus={mode === "decode"}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={checked !== null}
          placeholder={mode === "decode" ? "e.g. kafes" : "Tap the mic, or type"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="field min-w-0 flex-1 text-center text-xl"
        />
        {mode === "say" && checked === null && <MicButton lang={item.lang} onTranscript={(t) => setTyped(t)} />}
      </form>
      {checked === null ? (
        <button type="button" onClick={() => check()} disabled={!typed.trim()} className="btn-primary mt-3 w-full">
          Check
        </button>
      ) : (
        <Feedback right={checked} onContinue={() => onAnswer(checked)}>
          <p className="mt-1 text-sm" lang={item.lang}>
            {item.display} · {item.romanization} · {item.gloss}
          </p>
          {misread && (
            <p className="mt-1 text-sm text-bad">
              {misread.letter} looks like {misread.looks} but says {misread.says}.
            </p>
          )}
        </Feedback>
      )}
    </div>
  );
}

/** Put the phrase together from its word tiles. */
function Build({ tiles, item, onAnswer }: { tiles: string[]; item: LessonItemView; onAnswer: Answer }) {
  const { cloud } = useSpeechSettings();
  const [placed, setPlaced] = useState<number[]>([]);
  const [checked, setChecked] = useState<boolean | null>(null);
  const built = placed.map((i) => tiles[i]).join(" ");
  function check() {
    const ok = built === item.display;
    setChecked(ok);
    if (item.speak) playSpeech(cloud, item.lang, item.speak);
  }
  return (
    <div className="card mt-4 p-5 text-center">
      <p className="text-sm text-muted">Put it together</p>
      <p className="mt-3 text-2xl">{item.gloss}</p>
      <div className="mt-5 min-h-12 rounded-2xl border border-dashed border-line px-3 py-2 text-xl" lang={item.lang}>
        {built || <span className="text-sm text-muted">Tap the words in order</span>}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2" lang={item.lang}>
        {tiles.map((t, i) => (
          <button
            key={i}
            type="button"
            disabled={placed.includes(i) || checked !== null}
            onClick={() => setPlaced((p) => [...p, i])}
            className="rounded-xl border border-line bg-card px-3 py-2 text-lg disabled:opacity-30"
          >
            {t}
          </button>
        ))}
      </div>
      {checked === null ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setPlaced([])} disabled={!placed.length} className="btn-secondary">
            Clear
          </button>
          <button type="button" onClick={check} disabled={placed.length !== tiles.length} className="btn-primary">
            Check
          </button>
        </div>
      ) : (
        <Feedback right={checked} onContinue={() => onAnswer(checked)}>
          <p className="mt-1 text-sm" lang={item.lang}>
            {item.display}
          </p>
        </Feedback>
      )}
    </div>
  );
}

/** Match each word to its meaning. A wrong pair counts against the word picked. */
function Pairs({ items, onAnswer }: { items: LessonItemView[]; onAnswer: Answer }) {
  const { cloud } = useSpeechSettings();
  const right = useMemo(() => [...items].sort((a, b) => a.gloss.localeCompare(b.gloss)), [items]);
  const [left, setLeft] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrong, setWrong] = useState<string | null>(null);
  const missed = useRef<string[]>([]);

  function pickRight(id: string) {
    if (!left) return;
    if (id === left) {
      const it = items.find((i) => i.atomId === id);
      if (it?.speak) playSpeech(cloud, it.lang, it.speak);
      setMatched((m) => [...m, id]);
      setLeft(null);
    } else {
      if (!missed.current.includes(left)) missed.current.push(left);
      setWrong(id);
      setTimeout(() => setWrong(null), 500);
      setLeft(null);
    }
  }

  const finished = matched.length === items.length;
  return (
    <div className="card mt-4 p-5">
      <p className="text-center text-sm text-muted">Match them up</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2" lang={items[0]?.lang}>
          {items.map((i) => (
            <button
              key={i.atomId}
              type="button"
              disabled={matched.includes(i.atomId)}
              onClick={() => setLeft(i.atomId)}
              className={`rounded-xl border px-3 py-2.5 text-lg disabled:opacity-25 ${left === i.atomId ? "border-sage bg-tint-sage" : "border-line bg-card"}`}
            >
              {i.display}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {right.map((i) => (
            <button
              key={i.atomId}
              type="button"
              disabled={matched.includes(i.atomId)}
              onClick={() => pickRight(i.atomId)}
              className={`rounded-xl border px-3 py-2.5 text-sm disabled:opacity-25 ${wrong === i.atomId ? "border-bad bg-tint-rose" : "border-line bg-card"}`}
            >
              {i.gloss}
            </button>
          ))}
        </div>
      </div>
      {finished && (
        <button type="button" onClick={() => onAnswer(true, missed.current)} className="btn-primary mt-4 w-full">
          Continue
        </button>
      )}
    </div>
  );
}

// ---- Done ----------------------------------------------------------------------

function Done({ lesson, stats }: { lesson: LessonPayload; stats: Record<string, ItemStats> }) {
  const [result, setResult] = useState<LessonResult | { error: string } | null>(null);
  const sent = useRef(false);

  async function send() {
    setResult(null);
    setResult(await finishLesson({ lessonId: lesson.lessonId, stats }));
  }

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    finishLesson({ lessonId: lesson.lessonId, stats }).then(setResult);
  }, [lesson.lessonId, stats]);

  return (
    <section className="card mt-6 p-6 text-center">
      <h2 className="font-display text-3xl">Lesson done</h2>
      {!result ? (
        <p className="mt-3 text-sm text-muted">Saving…</p>
      ) : "error" in result ? (
        <>
          <p className="mt-3 text-sm text-bad">{result.error}</p>
          <button type="button" onClick={send} className="btn-secondary mt-3">
            Try again
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-lg">
            {result.replay
              ? "Replayed. Your reviews are unchanged."
              : `${result.added} ${result.added === 1 ? "word" : "words"} added to your reviews, first due tomorrow.`}
          </p>
          {!result.replay && result.alreadyKnown > 0 && <p className="mt-1 text-sm text-muted">{result.alreadyKnown} you already had keep their place.</p>}
          <p className="mt-1 text-sm text-muted">
            {lesson.unitTitle}: lesson {lesson.n} of {lesson.total}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
            <Link href="/learn" className="btn-primary">
              Back to the path
            </Link>
            <Link href="/" className="btn-secondary">
              Home
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
