/**
 * GET /api/speech?lang=el&text=καφές[&voice=1][&rate=slow]  (SPEC §15)
 * Redirects to the stored clip, voicing it first on a miss. 404 without a
 * provider, so the browser falls back to its own voice.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { serveSpeech } from "@/lib/speech/http";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return serveSpeech(request);
}
