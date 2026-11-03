import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth";
import { isAllowedEmail } from "@/lib/auth-rules";
import { updateSession, withCookies } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  // Preflights carry no cookies; redirecting one only turns the real request into "Failed to fetch".
  if (request.method === "OPTIONS" || request.method === "HEAD") return NextResponse.next();
  // API v1 authenticates with a bearer token, not the cookie (SPEC §19); its routes check it.
  if (request.nextUrl.pathname.startsWith("/api/v1/")) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const { claims, response } = await updateSession(request);

  // The login page sorts out signed-in and not-allowed visitors itself.
  if (pathname === "/login" || pathname.startsWith("/auth/")) return response;
  if (claims && isAllowedEmail(claims.email)) return response;

  // No session: don't forward the cookies updateSession produced. When several requests race to
  // refresh an expired token, the losers come back with cookies that clear the session; passing
  // those on would sign the browser out of the whole suite although the winner refreshed it fine.
  const keep = (res: NextResponse) => (claims ? withCookies(res, response) : res);

  // Server actions (POSTs) check for themselves (learner() in lib/learner.ts) and answer with a
  // redirect the client router follows. A 307 here would replay the POST against /login instead.
  // Without a session, pass the original cookies through so the action can try its own refresh.
  if (request.method !== "GET") return claims ? response : NextResponse.next();

  if (pathname.startsWith("/api/")) return keep(NextResponse.json({ error: "not signed in" }, { status: 401 }));
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return keep(NextResponse.redirect(login));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
