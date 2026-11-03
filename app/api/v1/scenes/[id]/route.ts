import { getScene } from "@/lib/api/v1/handlers";
import { api } from "@/lib/api/v1/route";

/** Opens the scene's current visit (or ?visit=n), as opening it on the web does. */
export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  api(request, async ({ d, me, url }) => getScene(d, me, (await params).id, Number(url.searchParams.get("visit")) || undefined));
