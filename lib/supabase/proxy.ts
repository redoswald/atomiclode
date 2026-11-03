import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { suiteCookieOptions } from "./cookie-options";

/**
 * Refreshes the Supabase session for proxy.ts and returns the verified
 * claims. Any redirect built from here must carry `response`'s cookies, or a
 * refreshed token is lost (see withCookies).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    ...suiteCookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims?.sub ? data.claims : null;

  return { claims, response };
}

/** Copies refreshed session cookies onto a redirect. */
export function withCookies(redirect: NextResponse, from: NextResponse): NextResponse {
  from.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}
