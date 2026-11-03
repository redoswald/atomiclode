import { db, hasDatabase } from "@/db";
import { deleteAccount } from "@/lib/account/handler";

/** Delete everything Dolomite holds for the signed-in suite account (lib/account). */
export const DELETE = (request: Request) => deleteAccount(request, () => (hasDatabase() ? db() : null));
