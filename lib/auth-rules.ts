/**
 * Pure sign-in rules, shared by proxy.ts, server actions and tests.
 *
 * Dolomite signs in with the Done Intentionally suite account (Supabase Auth),
 * but a suite account alone is not enough: the Anthropic key is ours to spend,
 * so only emails in ALLOWED_EMAILS get in. An empty list lets nobody in.
 */

/** "a@x.com, B@y.com" → {"a@x.com", "b@y.com"}. Commas, whitespace or semicolons separate. */
export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowedEmail(email: string | null | undefined, raw = process.env.ALLOWED_EMAILS): boolean {
  if (!email) return false;
  return parseAllowlist(raw).has(email.trim().toLowerCase());
}

/** Only same-site paths survive as a post-login destination. */
export function safeNext(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}
