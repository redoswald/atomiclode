import { getMe } from "@/lib/api/v1/handlers";
import { api } from "@/lib/api/v1/route";

export const GET = (request: Request) => api(request, ({ d, user, me }) => getMe(d, user, me));
