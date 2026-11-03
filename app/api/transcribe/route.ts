/**
 * POST /api/transcribe  multipart: audio (a recorded answer), lang
 * Returns { text }. Speak-your-answer: the transcript fills the answer box.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { isLang } from "@/lib/lang";
import { hasStt, MAX_AUDIO_BYTES, transcribe } from "@/lib/speech/stt";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
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
