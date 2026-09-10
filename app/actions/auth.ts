"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, authEnabled, constantTimeEqual, sessionToken } from "@/lib/auth";

export async function login(formData: FormData): Promise<void> {
  if (!authEnabled()) redirect("/");
  const secret = String(formData.get("secret") ?? "");
  const next = safeNext(formData.get("next"));
  if (!constantTimeEqual(secret, process.env.APP_SECRET!)) {
    redirect(`/login?error=1${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);
  }
  const store = await cookies();
  store.set({
    name: AUTH_COOKIE,
    value: await sessionToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(next);
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect("/login");
}

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}
