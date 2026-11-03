import { postReview } from "@/lib/api/v1/handlers";
import { api, body } from "@/lib/api/v1/route";

export const POST = (request: Request) => api(request, async ({ d, me }) => postReview(d, me, await body(request)));
