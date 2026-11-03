/**
 * DELETE /api/v1/account, as a function of its dependencies so tests can drive it.
 * Not routed through api()/apiLearner(): that would re-seed the learner being
 * deleted (ensureLearner) and could hand them the legacy rows (claimLegacy).
 *
 * 200 {"deleted":true} (also when there was nothing to delete), 401 bad or missing
 * token, 403 when sign-in is off, 500/503 {"error":…, "retryable":true}.
 */
import { NextResponse } from "next/server";
import type { Db } from "@/db";
import { deletingUser, type VerifyFn } from "@/lib/api/v1/auth";
import { ApiError, errorResponse } from "@/lib/api/v1/http";
import { NIL_USER } from "@/lib/learners/provision";
import { deleteAccountData } from "./delete";

export async function deleteAccount(request: Request, getDb: () => Db | null, verify?: VerifyFn): Promise<Response> {
  let user;
  try {
    user = await deletingUser(request, verify);
    if (user.id === NIL_USER) throw new ApiError(403, "not_allowed", "That account can't be deleted.");
  } catch (err) {
    return errorResponse(err);
  }
  const d = getDb();
  if (!d) return NextResponse.json({ error: { code: "unavailable", message: "No database configured." }, retryable: true }, { status: 503 });
  try {
    const n = await deleteAccountData(d, user.id);
    console.info(`account deleted: ${user.id} (${n} rows)`);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error(`account deletion failed for ${user.id}`, err);
    return NextResponse.json(
      { error: { code: "error", message: "Couldn't delete your Dolomite data; try again." }, retryable: true },
      { status: 500 },
    );
  }
}
