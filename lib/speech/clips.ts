/**
 * Speech clips (SPEC §15): voiced once, stored in Vercel Blob, shared by every
 * learner. The synthesizer and the store are injectable so tests run offline.
 */
import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { speechClips } from "@/db/schema";
import { LANG_SPECS, type Lang } from "@/lib/lang";
import { MAX_SPEECH_CHARS, normalizeSpeech, type SpeechRate, type VoiceIndex } from "./say";
import { synthesize as googleSynthesize, type SynthesizeFn } from "./tts";

export type StoreFn = (pathname: string, audio: Uint8Array) => Promise<string>;

/** Public, unguessable-by-content path; overwriting is harmless (same text, same audio). */
export const blobStore: StoreFn = async (pathname, audio) => {
  const blob = await put(pathname, Buffer.from(audio), {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });
  return blob.url;
};

/** Bumped when every clip should be voiced again (v2: clips start with a silent lead-in). */
export const CLIP_VERSION = 2;

export function clipKey(lang: Lang, voice: string, rate: SpeechRate, text: string): string {
  return createHash("sha256").update(`v${CLIP_VERSION}|${lang}|${voice}|${rate}|${text}`).digest("hex");
}

export interface ClipRequest {
  lang: Lang;
  text: string;
  voice?: VoiceIndex;
  rate?: SpeechRate;
}

/** The clip's public URL, voicing and storing it first if it doesn't exist yet. */
export async function getOrCreateClip(
  d: Db,
  req: ClipRequest,
  deps: { synthesize?: SynthesizeFn; store?: StoreFn } = {},
): Promise<{ url: string; created: boolean }> {
  const text = normalizeSpeech(req.text);
  if (!text) throw new Error("Nothing to say.");
  if (text.length > MAX_SPEECH_CHARS) throw new Error(`Too long to voice (${MAX_SPEECH_CHARS} characters max).`);
  const spec = LANG_SPECS[req.lang].speech;
  const voice = spec.voices[req.voice ?? 0];
  const rate = req.rate ?? "normal";
  const key = clipKey(req.lang, voice, rate, text);

  const [hit] = await d.select({ url: speechClips.url }).from(speechClips).where(eq(speechClips.key, key));
  if (hit) return { url: hit.url, created: false };

  const audio = await (deps.synthesize ?? googleSynthesize)({ text, languageCode: spec.languageCode, voice, rate });
  const url = await (deps.store ?? blobStore)(`speech/${key}.mp3`, audio);
  await d.insert(speechClips).values({ key, lang: req.lang, voice, rate, text, url, bytes: audio.byteLength }).onConflictDoNothing();
  return { url, created: true };
}
