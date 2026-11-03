import { patchSettings } from "@/lib/api/v1/handlers";
import { api, body } from "@/lib/api/v1/route";

export const PATCH = (request: Request) => api(request, async ({ d, user }) => patchSettings(d, user, await body(request)));
