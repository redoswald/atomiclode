"use client";

/**
 * Speak your answer: record, transcribe, hand the text back to fill the answer
 * box. The learner still presses Check, so a mishearing is seen before it is graded.
 */
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/lang";
import { stopSpeech, useSpeechSettings } from "./speech";

/** Long enough for a produce answer, short enough to stay well under the upload cap. */
const MAX_SECONDS = 30;

type State = "idle" | "recording" | "transcribing";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find((t) => MediaRecorder.isTypeSupported(t));
}

export function MicButton({ lang, onTranscript, disabled = false }: { lang: Lang; onTranscript: (text: string) => void; disabled?: boolean }) {
  const { stt } = useSpeechSettings();
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The transcript arrives after an upload; hand it to the latest callback, not the one from when recording began.
  const deliver = useRef(onTranscript);
  useEffect(() => {
    deliver.current = onTranscript;
  });
  const supported = typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
    },
    [],
  );

  if (!stt || !supported) return null;

  async function start() {
    setError(undefined);
    stopSpeech();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone blocked. Allow it in the browser's site settings.");
      return;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      const audio = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      if (audio.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", audio);
        form.append("lang", lang);
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? `Transcription failed (${res.status})`);
        if (data.text) deliver.current(data.text);
        else setError("Didn't catch that. Try again, a little closer.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setState("idle");
      }
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS && rec.state === "recording") rec.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const recording = state === "recording";
  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || state === "transcribing"}
        aria-label={recording ? "Stop recording" : "Speak your answer"}
        title={recording ? "Stop" : "Speak your answer"}
        className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-sm disabled:opacity-50 ${
          recording ? "border-bad bg-tint-rose text-ink" : "border-line bg-card text-ink"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {recording ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /> : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>}
        </svg>
        {state === "transcribing" ? "…" : recording ? `${seconds}s` : null}
      </button>
      {error && <span className="mt-1 max-w-56 text-center text-xs text-bad">{error}</span>}
    </span>
  );
}
