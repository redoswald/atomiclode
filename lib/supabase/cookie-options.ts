import type { CookieOptionsWithName } from "@supabase/ssr";

// Suite SSO: in production every *.doneintentionally.com app scopes the
// Supabase auth cookie to the apex domain under one shared name, so a single
// login works across the suite. NEXT_PUBLIC_AUTH_COOKIE_DOMAIN is set only in
// production — localhost and *.vercel.app previews must leave it unset, since
// browsers reject a foreign Domain attribute there and login would break.
// The suite-wide name (instead of the default sb-<project-ref>-auth-token)
// means the old host-scoped cookies are never read again; they expire on their
// own and users sign in once more after rollout.
// Cross-app contract — keep this file identical in tend-web, attend-web, and
// portend-web. See https://github.com/redoswald/attend-web/issues/1
const domain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN;

export const suiteCookieOptions: { cookieOptions?: CookieOptionsWithName } =
  domain
    ? { cookieOptions: { name: "sb-doneintentionally-auth", domain } }
    : {};
