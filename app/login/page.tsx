import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn, signInWithGoogle, signOut, signUp } from "@/app/actions/auth";
import { Shell } from "@/app/components/shell";
import { authEnabled, getSessionUser } from "@/lib/auth";
import { isAllowedEmail, parseAllowlist, safeNext } from "@/lib/auth-rules";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid: "That email and password didn't match.",
  unconfirmed: "Confirm your email first: there's a link in your inbox.",
  "not-listed": "That email isn't on Dolomite's list. Ask Aaron to add it.",
  exists: "There's already a suite account for that email. Sign in instead.",
  signup: "Couldn't create the account. Try a longer password?",
  callback: "That sign-in didn't go through. Try again.",
  "check-email": "Check your email for a confirmation link, then come back here.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!authEnabled()) redirect("/");
  const params = await searchParams;
  const next = safeNext(params.next);
  const mode = params.mode === "signup" ? "signup" : "signin";
  const code = typeof params.error === "string" ? params.error : "";
  const message = MESSAGES[code];

  const user = await getSessionUser();
  if (user && isAllowedEmail(user.email)) redirect(next);

  if (user) {
    return (
      <Shell nav={false}>
        <section className="card mt-4 flex flex-col gap-3 p-5">
          <h2 className="font-display text-2xl">Not on the list</h2>
          <p className="text-sm leading-6 text-muted">
            You&apos;re signed in to Done Intentionally as <span className="text-ink">{user.email}</span>, but Dolomite is only
            open to a few people. Ask Aaron to add that email, or sign in with another account.
          </p>
          <form action={signOut}>
            <button type="submit" className="btn-secondary w-full">
              Sign out
            </button>
          </form>
        </section>
      </Shell>
    );
  }

  const noOneListed = parseAllowlist(process.env.ALLOWED_EMAILS).size === 0;
  const toggle = new URLSearchParams(next === "/" ? {} : { next });
  if (mode === "signin") toggle.set("mode", "signup");

  return (
    <Shell nav={false}>
      <section className="card mt-4 flex flex-col gap-3 p-5">
        <h2 className="font-display text-2xl">{mode === "signup" ? "Create your account" : "Sign in"}</h2>
        <p className="text-sm text-muted">
          {mode === "signup"
            ? "One account for Dolomite and the rest of Done Intentionally."
            : "Use your Done Intentionally account."}
        </p>

        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="btn-secondary w-full">
            Continue with Google
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or with email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form action={mode === "signup" ? signUp : signIn} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          {mode === "signup" && (
            <input name="name" autoComplete="name" placeholder="Name (optional)" className="field text-base" />
          )}
          <input name="email" type="email" autoComplete="email" autoFocus required placeholder="Email" className="field text-base" />
          <input
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            placeholder="Password"
            className="field text-base"
          />
          {message && <p className={`text-sm ${code === "check-email" ? "text-ink" : "text-bad"}`}>{message}</p>}
          <button type="submit" className="btn-primary">
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          {mode === "signup" ? "Already have an account? " : "New here? "}
          <Link href={`/login${toggle.size ? `?${toggle}` : ""}`} className="text-ink underline">
            {mode === "signup" ? "Sign in" : "Create an account"}
          </Link>
        </p>

        {noOneListed && (
          <p className="rounded-xl border border-tint-sand bg-tint-sand/50 px-3 py-2 text-xs">
            <code className="font-mono">ALLOWED_EMAILS</code> is empty, so nobody can get in yet. Set it in Vercel and redeploy.
          </p>
        )}
      </section>
    </Shell>
  );
}
