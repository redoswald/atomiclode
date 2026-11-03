/**
 * API v1 auth (SPEC §19): `Authorization: Bearer <Supabase access token>` from the
 * suite account. Verified locally (getClaims), held to ALLOWED_EMAILS, and turned
 * into a learner exactly as the web's learner() does, starter content included.
 */
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/db";
import { authEnabled, LOCAL_USER, type AppUser } from "@/lib/auth";
import { isAllowedEmail } from "@/lib/auth-rules";
import { isLang, type Lang } from "@/lib/lang";
import { isLegacyOwner } from "@/lib/learner";
import { claimLegacy, ensureLearner, type Learner } from "@/lib/learners/provision";
import { ApiError } from "./http";

export type VerifyFn = (token: string) => Promise<AppUser | null>;

/** Verify a Supabase access token; null when it isn't valid. */
export const verifyToken: VerifyFn = async (token) => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.auth.getClaims(token);
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return null;
  const meta = (claims.user_metadata ?? {}) as Record<string, string | undefined>;
  return { id: claims.sub, email: claims.email, name: meta.full_name || meta.name || null };
};

/** The signed-in, allowed user behind a request, or a 401 / 403. */
export async function apiUser(request: Request, verify: VerifyFn = verifyToken): Promise<AppUser> {
  if (!authEnabled()) return LOCAL_USER;
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token) throw new ApiError(401, "unauthenticated", "Sign in first.");
  const user = await verify(token);
  if (!user) throw new ApiError(401, "unauthenticated", "Your session has expired; sign in again.");
  if (!isAllowedEmail(user.email)) throw new ApiError(403, "not_allowed", "This account isn't on Dolomite's list.");
  return user;
}

/** The track a request is about: `?lang=`, default Greek (the app's first course). */
export function trackOf(request: Request): Lang {
  const lang = new URL(request.url).searchParams.get("lang");
  if (lang === null) return "el";
  if (!isLang(lang)) throw new ApiError(400, "bad_request", "Unknown lang.");
  return lang;
}

/** The learner for this request, with their starter content in place. */
export async function apiLearner(d: Db, request: Request, verify?: VerifyFn): Promise<{ user: AppUser; me: Learner }> {
  const user = await apiUser(request, verify);
  const lang = trackOf(request);
  if (isLegacyOwner(user)) await claimLegacy(d, user.id);
  await ensureLearner(d, user.id, lang);
  return { user, me: { userId: user.id, lang } };
}
