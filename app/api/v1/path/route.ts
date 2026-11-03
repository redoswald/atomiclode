import { getPath } from "@/lib/api/v1/handlers";
import { api } from "@/lib/api/v1/route";

export const GET = (request: Request) => api(request, ({ d, me }) => getPath(d, me));
