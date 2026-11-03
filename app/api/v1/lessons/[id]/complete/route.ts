import { postLessonComplete } from "@/lib/api/v1/handlers";
import { api, body } from "@/lib/api/v1/route";

export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  api(request, async ({ d, me }) => postLessonComplete(d, me, (await params).id, await body(request)));
