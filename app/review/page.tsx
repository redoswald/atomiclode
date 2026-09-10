import Link from "next/link";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { hasAnthropicKey } from "@/lib/llm/client";
import { buildSession, parseIntensity } from "@/lib/review/session";
import { ReviewSession } from "./session";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const intensity = parseIntensity(params.intensity);

  if (!hasDatabase()) {
    return (
      <Shell title="Review">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }

  const session = await buildSession(db(), intensity);
  if (session.cards.length === 0) {
    return (
      <Shell title="Review" eyebrow="Real usage. Lasting fluency.">
        <section className="card p-5">
          <h2 className="font-display text-2xl">Nothing to review</h2>
          <p className="mt-2 text-sm text-muted">
            Nothing is due and there are no new atoms to introduce
            {intensity === "light" ? " (light sessions skip new atoms)" : ""}.
            {session.plan.deferred > 0 && ` ${session.plan.deferred} deferred.`}
          </p>
          <div className="mt-4 flex gap-3 text-sm">
            {intensity !== "push" && (
              <Link href="/review?intensity=push" className="underline">
                Try a push session
              </Link>
            )}
            <Link href="/read" className="underline">
              Read instead
            </Link>
          </div>
        </section>
      </Shell>
    );
  }

  return (
    <Shell title="Review" eyebrow="Real usage. Lasting fluency.">
      <ReviewSession key={`${intensity}-${session.cards.map((c) => c.atomId).join(",")}`} session={session} canWhy={hasAnthropicKey()} />
    </Shell>
  );
}
