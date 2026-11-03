import Link from "next/link";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { learner } from "@/lib/learner";
import { hasAnthropicKey } from "@/lib/llm/client";
import { buildSession, parseIntensity } from "@/lib/review/session";
import { ReviewSession } from "./session";

export const dynamic = "force-dynamic";
// Building a session may write a few produce prompts with the model.
export const maxDuration = 60;

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

  // Reviews come in rounds of about five minutes (SPEC §17 Pacing).
  const round = Math.max(1, Math.min(99, Number(params.round) || 1));
  const session = await buildSession(db(), await learner(), intensity, new Date(), { round: true });
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
      <p className="mb-3 text-xs text-muted">
        Round {round}
        {session.left.cards > 0 ? ` of about ${round + Math.ceil(session.left.minutes / 5)}` : ""} · about 5 min
      </p>
      <ReviewSession key={`${intensity}-${round}-${session.cards.map((c) => c.atomId).join(",")}`} session={session} canWhy={hasAnthropicKey()} round={round} />
    </Shell>
  );
}
