/**
 * The bodies of the speech and transcription routes (SPEC §15), shared by the web
 * routes (cookie session) and API v1 (bearer token). Callers check sign-in first.
 */
import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/db";
import { isLang } from "@/lib/lang";
import { getOrCreateClip } from "./clips";
import { hasStt, MAX_AUDIO_BYTES, transcribe } from "./stt";
import { hasTts } from "./tts";

/** Redirect to the clip, voicing it first on a miss; 404 without a provider. */
export async function serveSpeech(request: Request): Promise<Response> {
  if (!hasTts() || !hasDatabase()) return NextResponse.json({ error: "speech is not configured" }, { status: 404 });
  const p = new URL(request.url).searchParams;
  const lang = p.get("lang");
  const text = p.get("text") ?? "";
  if (!isLang(lang) || !text.trim()) return NextResponse.json({ error: "lang and text are required" }, { status: 400 });
  try {
    const { url } = await getOrCreateClip(db(), {
      lang,
      text,
      voice: p.get("voice") === "1" ? 1 : 0,
      rate: p.get("rate") === "slow" ? "slow" : "normal",
    });
    const res = NextResponse.redirect(url, 302);
    // The clip at that URL never changes; let the client skip this hop next time.
    res.headers.set("cache-control", "private, max-age=604800");
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /too long|nothing to say/i.test(message) ? 400 : 502 });
  }
}

/** multipart audio + lang → { text }. */
export async function serveTranscribe(request: Request): Promise<Response> {
  if (!hasStt()) return NextResponse.json({ error: "Speaking isn't set up (OPENAI_API_KEY)." }, { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a recording." }, { status: 400 });
  }
  const audio = form.get("audio");
  const lang = form.get("lang");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "Nothing was recorded." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too long; keep it under a minute." }, { status: 413 });
  if (!isLang(lang)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  try {
    return NextResponse.json({ text: await transcribe(audio, lang) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
