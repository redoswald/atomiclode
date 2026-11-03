import { postSceneTurnDone } from "@/lib/api/v1/handlers";
import { badRequest } from "@/lib/api/v1/http";
import { api, body } from "@/lib/api/v1/route";

export const POST = (request: Request) =>
  api(request, async ({ d, me }) => {
    const { visitId } = await body<{ visitId?: unknown }>(request);
    if (typeof visitId !== "string") throw badRequest("visitId is required");
    return postSceneTurnDone(d, me, visitId);
  });
