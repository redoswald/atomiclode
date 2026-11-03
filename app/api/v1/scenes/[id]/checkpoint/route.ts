import { postCheckpoint } from "@/lib/api/v1/handlers";
import { badRequest } from "@/lib/api/v1/http";
import { api, body } from "@/lib/api/v1/route";

export const POST = (request: Request) =>
  api(request, async ({ d, me }) => {
    const { lessonId } = await body<{ lessonId?: unknown }>(request);
    if (typeof lessonId !== "string") throw badRequest("lessonId is required");
    return postCheckpoint(d, me, lessonId);
  });
