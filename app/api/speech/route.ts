/**
 * GET /api/speech?lang=el&text=καφές[&voice=1][&rate=slow]  (SPEC §15)
 * Redirects to the stored clip, voicing it first on a miss. 404 without a
 * provider, so the browser falls back to its own voice.
 */
import { NextResponse, type NextRequest } from "next/server";
import { db, hasDatabase } from "@/db";
import { getUser } from "@/lib/auth";
import { isLang } from "@/lib/lang";
import { getOrCreateClip } from "@/lib/speech/clips";
import { hasTts } from "@/lib/speech/tts";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasTts() || !hasDatabase()) return NextResponse.json({ error: "speech is not configured" }, { status: 404 });

  const p = request.nextUrl.searchParams;
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
    // The clip at that URL never changes; let the browser skip this hop next time.
    res.headers.set("cache-control", "private, max-age=604800");
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: /too long|nothing to say/i.test(message) ? 400 : 502 });
  }
}
