import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth-rules";
import { createClient } from "@/lib/supabase/server";

/** Google sign-in and email confirmation both return here with a PKCE code. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=callback`);
}
