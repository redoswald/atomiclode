import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { listGoals } from "@/lib/goals/goals";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  if (!hasDatabase()) {
    return (
      <Shell title="Goal">
        <p className="text-sm text-muted">No database configured.</p>
      </Shell>
    );
  }
  const all = await listGoals(db());
  const active = all.find((g) => g.status === "active");
  if (active && all.length === 1) redirect(`/goal/${active.id}`);

  return (
    <Shell title="Goal" eyebrow="A text you want to read. Eventually.">
      {all.length === 0 ? (
        <section className="card p-5 text-sm leading-6">
          <p>
            Is there something in French you can&apos;t read yet and wish you could? A letter, a family history, a chapter of a book.
          </p>
          <p className="mt-3 text-muted">
            Paste it into the <Link href="/read" className="underline">reader</Link>, open it, and press <em>Make this my goal</em>. From then on it decides which words you
            learn next, and you can watch the share of it you understand go up.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {all.map((g) => (
            <li key={g.id}>
              <Link href={`/goal/${g.id}`} className={`card block p-4 ${g.status === "active" ? "border-sage" : ""}`}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-2xl leading-tight">{g.title}</span>
                  <span className="shrink-0 text-xs text-muted">{g.status === "reached" ? "read" : g.status}</span>
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {g.passageIds.length} {g.passageIds.length === 1 ? "section" : "sections"} · pinned {g.pinnedAt.slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
