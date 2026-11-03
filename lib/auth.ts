/**
 * Sign-in with the Done Intentionally suite account (SPEC §9).
 *
 * Supabase Auth is the identity: the session cookie is the suite's, so a
 * sign-in on any *.doneintentionally.com app signs you in here too. On top of
 * that, only emails in ALLOWED_EMAILS may use Dolomite (lib/auth-rules.ts).
 *
 * When the Supabase env vars are unset the app is open and every request acts
 * as LOCAL_USER; the home page says so. That keeps local dev and the PGlite
 * tests free of an auth server.
 */
import { cache } from "react";
import { isAllowedEmail } from "@/lib/auth-rules";
import { createClient } from "@/lib/supabase/server";

export interface AppUser {
  /** auth.users.id */
  id: string;
  email: string;
  name: string | null;
}

/** Stand-in identity while auth is off. A fixed id, so local data has one owner. */
export const LOCAL_USER: AppUser = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "local@localhost",
  name: null,
};

export function authEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The signed-in suite user, allowed or not, from the verified access token.
 * getClaims checks the signature locally with asymmetric keys (no network
 * call) and falls back to asking Supabase with legacy keys.
 */
export const getSessionUser = cache(async (): Promise<AppUser | null> => {
  if (!authEnabled()) return LOCAL_USER;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || !claims.email) return null;
  const meta = (claims.user_metadata ?? {}) as Record<string, string | undefined>;
  return { id: claims.sub, email: claims.email, name: meta.full_name || meta.name || null };
});

/** The signed-in user if they may use Dolomite, else null. */
export async function getUser(): Promise<AppUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  if (!authEnabled()) return user;
  return isAllowedEmail(user.email) ? user : null;
}

/**
 * For server actions and route handlers: they are reachable by direct POST,
 * so each one checks for itself rather than trusting proxy.ts.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  return user;
}
