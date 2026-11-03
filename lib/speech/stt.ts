/**
 * Speech-to-text for speak-your-answer: OpenAI's `gpt-transcribe` (the
 * `whisper-1` and `gpt-4o-*-transcribe` models shut down on 26 February 2027).
 * The transcript goes into the answer box and is checked like typed text, so the
 * learner sees what was heard before anything is graded.
 */
import type { Lang } from "@/lib/lang";

export const STT_MODEL = "gpt-transcribe";
/** Longest recording accepted, in bytes (about a minute of compressed speech). */
export const MAX_AUDIO_BYTES = 5_000_000;

export function hasStt(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export type TranscribeFn = (audio: Blob, lang: Lang) => Promise<string>;

/** Extension OpenAI recognizes for what the browser recorded (Chrome: webm, Safari: mp4). */
function filename(type: string): string {
  if (type.includes("webm")) return "answer.webm";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "answer.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "answer.mp3";
  if (type.includes("wav")) return "answer.wav";
  return "answer.webm";
}

export const transcribe: TranscribeFn = async (audio, lang) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const form = new FormData();
  form.append("file", audio, filename(audio.type));
  form.append("model", STT_MODEL);
  // The learner is answering in the language they're learning; saying so stops a
  // short, accented answer from being heard as English.
  form.append("languages[]", lang);
  form.append("response_format", "json");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`Transcription failed: ${data.error?.message ?? res.status}`);
  return (data.text ?? "").trim();
};
