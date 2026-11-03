import { getReview } from "@/lib/api/v1/handlers";
import { api } from "@/lib/api/v1/route";

// Building a round may write a few produce prompts with the model.
export const maxDuration = 60;

export const GET = (request: Request) =>
  api(request, ({ d, me, caps, url }) => getReview(d, me, caps, { intensity: url.searchParams.get("intensity"), round: url.searchParams.get("round") }));
