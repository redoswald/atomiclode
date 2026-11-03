import { apiUser } from "@/lib/api/v1/auth";
import { errorResponse } from "@/lib/api/v1/http";
import { serveSpeech } from "@/lib/speech/http";

export const maxDuration = 30;

/** GET /api/v1/speech?lang&text[&voice=1][&rate=slow]: redirect to the clip (SPEC §15). */
export async function GET(request: Request) {
  try {
    await apiUser(request);
  } catch (err) {
    return errorResponse(err);
  }
  return serveSpeech(request);
}
