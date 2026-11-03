import { postProduceCheck } from "@/lib/api/v1/handlers";
import { api, body } from "@/lib/api/v1/route";

export const maxDuration = 60;

export const POST = (request: Request) => api(request, async ({ d, me }) => postProduceCheck(d, me, await body(request)));
