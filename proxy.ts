import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/auth";
import { isAllowedEmail } from "@/lib/auth-rules";
import { updateSession, withCookies } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const { claims, response } = await updateSession(request);

  // The login page sorts out signed-in and not-allowed visitors itself.
  if (pathname === "/login" || pathname.startsWith("/auth/")) return response;
  if (claims && isAllowedEmail(claims.email)) return response;

  if (pathname.startsWith("/api/")) {
    return withCookies(NextResponse.json({ error: "not signed in" }, { status: 401 }), response);
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return withCookies(NextResponse.redirect(login), response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
