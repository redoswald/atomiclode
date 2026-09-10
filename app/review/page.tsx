import Link from "next/link";
import { db, hasDatabase } from "@/db";
import { buildSession, parseIntensity } from "@/lib/review/session";
import { ReviewSession } from "./session";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const intensity = parseIntensity(params.intensity);

  if (!hasDatabase()) {
    return (
      <Shell>
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }

  const session = await buildSession(db(), intensity);
  if (session.cards.length === 0) {
    return (
      <Shell>
        <h1 className="text-lg font-medium">Nothing to review</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing is due and there are no new atoms to introduce
          {intensity === "light" ? " (light sessions skip new atoms)" : ""}.
          {session.plan.deferred > 0 && ` ${session.plan.deferred} deferred.`}
        </p>
        <Link href="/" className="mt-6 inline-block text-sm underline">
          Home
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <ReviewSession key={`${intensity}-${session.cards.map((c) => c.atomId).join(",")}`} session={session} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-8 sm:py-12">{children}</main>;
}
