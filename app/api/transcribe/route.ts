/**
 * POST /api/transcribe  multipart: audio (a recorded answer), lang
 * Returns { text }. Speak-your-answer: the transcript fills the answer box.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { serveTranscribe } from "@/lib/speech/http";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await getUser())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return serveTranscribe(request);
}
