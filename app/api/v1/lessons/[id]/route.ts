import { getLesson } from "@/lib/api/v1/handlers";
import { api } from "@/lib/api/v1/route";

export const maxDuration = 60;

export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  api(request, async ({ d, me, caps, url }) => getLesson(d, me, (await params).id, caps, { refresh: url.searchParams.get("refresh") === "1" }));
