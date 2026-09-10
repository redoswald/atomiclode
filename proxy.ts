import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, isValidToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  if (await isValidToken(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
