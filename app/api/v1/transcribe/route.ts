import { apiUser } from "@/lib/api/v1/auth";
import { errorResponse } from "@/lib/api/v1/http";
import { serveTranscribe } from "@/lib/speech/http";

export const maxDuration = 60;

/** POST /api/v1/transcribe, multipart audio + lang → { text } (SPEC §15). */
export async function POST(request: Request) {
  try {
    await apiUser(request);
  } catch (err) {
    return errorResponse(err);
  }
  return serveTranscribe(request);
}
