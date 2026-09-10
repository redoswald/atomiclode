/**
 * Single-user auth (SPEC §9): one shared secret from APP_SECRET. A signed,
 * httpOnly cookie proves the visitor entered it. When APP_SECRET is unset the
 * app is open, and the home page says so.
 */
import { cookies } from "next/headers";

export const AUTH_COOKIE = "lode_auth";
const TOKEN_PURPOSE = "lode-session-v1";

export function authEnabled(): boolean {
  return Boolean(process.env.APP_SECRET);
}

/** HMAC-SHA256(APP_SECRET, purpose) as hex. Web Crypto so it also runs in proxy.ts. */
export async function sessionToken(): Promise<string> {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(TOKEN_PURPOSE));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidToken(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const expected = await sessionToken();
  return constantTimeEqual(value, expected);
}

/** True when auth is off, or the request carries a valid session cookie. */
export async function isAuthenticated(): Promise<boolean> {
  if (!authEnabled()) return true;
  const store = await cookies();
  return isValidToken(store.get(AUTH_COOKIE)?.value);
}

/** For server actions: they are reachable by direct POST, so check inside each one. */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) throw new Error("Not signed in");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
