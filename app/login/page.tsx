import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { Shell } from "@/app/components/shell";
import { authEnabled, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!authEnabled() || (await isAuthenticated())) redirect("/");
  const params = await searchParams;
  const error = params.error === "1";
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <Shell nav={false}>
      <form action={login} className="card mt-4 flex flex-col gap-3 p-5">
        <h2 className="font-display text-2xl">Sign in</h2>
        <p className="text-sm text-muted">Enter the app secret to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input name="secret" type="password" autoComplete="current-password" autoFocus required placeholder="Secret" className="field text-base" />
        {error && <p className="text-sm text-bad">That secret didn&apos;t match.</p>}
        <button type="submit" className="btn-primary">
          Sign in
        </button>
      </form>
    </Shell>
  );
}
