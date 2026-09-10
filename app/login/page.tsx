import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { authEnabled, isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!authEnabled() || (await isAuthenticated())) redirect("/");
  const params = await searchParams;
  const error = params.error === "1";
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-5 py-16">
      <h1 className="text-lg font-medium">Lode</h1>
      <p className="mt-1 text-sm text-muted">Enter the app secret to continue.</p>
      <form action={login} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <input
          name="secret"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Secret"
          className="rounded-md border border-line bg-transparent px-3 py-2 text-base outline-none focus:border-foreground"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">That secret didn&apos;t match.</p>}
        <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-background">
          Sign in
        </button>
      </form>
    </main>
  );
}
