"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth";
import { isAllowedEmail, safeNext } from "@/lib/auth-rules";
import { createClient } from "@/lib/supabase/server";

/** Back to /login with a message code (see MESSAGES in app/login/page.tsx). */
function back(code: string, next: string, mode?: "signup"): never {
  const q = new URLSearchParams({ error: code });
  if (next !== "/") q.set("next", next);
  if (mode) q.set("mode", mode);
  redirect(`/login?${q}`);
}

async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function signIn(formData: FormData): Promise<void> {
  if (!authEnabled()) redirect("/");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) back(error.code === "email_not_confirmed" ? "unconfirmed" : "invalid", next);
  // Not-allowed accounts land on /login, which explains and offers sign-out.
  redirect(next);
}

export async function signUp(formData: FormData): Promise<void> {
  if (!authEnabled()) redirect("/");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const next = safeNext(formData.get("next"));

  // Don't mint suite accounts for people who can't use Dolomite anyway.
  if (!isAllowedEmail(email)) back("not-listed", next, "signup");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: name ? { full_name: name } : undefined,
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) back(error.code === "user_already_exists" ? "exists" : "signup", next, "signup");
  if (!data.session) back("check-email", next);
  redirect(next);
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  if (!authEnabled()) redirect("/");
  const next = safeNext(formData.get("next"));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) back("callback", next);
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  if (authEnabled()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
