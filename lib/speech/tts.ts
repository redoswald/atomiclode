/**
 * Text-to-speech provider (SPEC §15): Google Cloud Text-to-Speech over REST with
 * an API key restricted to that API. One function, so the provider can be swapped.
 */
import type { SpeechRate } from "./say";

export const SLOW_RATE = 0.7;

export function hasTts(): boolean {
  return Boolean(process.env.GOOGLE_TTS_API_KEY);
}

export interface SynthesizeInput {
  text: string;
  /** BCP-47, e.g. "el-GR". */
  languageCode: string;
  /** Google voice name, e.g. "el-GR-Chirp3-HD-Leda". */
  voice: string;
  rate: SpeechRate;
}

export type SynthesizeFn = (input: SynthesizeInput) => Promise<Uint8Array>;

/** MP3 bytes for the text. Throws with Google's message on failure. */
export const synthesize: SynthesizeFn = async ({ text, languageCode, voice, rate }) => {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error("GOOGLE_TTS_API_KEY is not set");
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: rate === "slow" ? SLOW_RATE : 1 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string } };
  if (!res.ok || !data.audioContent) throw new Error(`Text-to-speech failed: ${data.error?.message ?? res.status}`);
  return Uint8Array.from(Buffer.from(data.audioContent, "base64"));
};
