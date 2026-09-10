import Link from "next/link";
import { notFound } from "next/navigation";
import { db, hasDatabase } from "@/db";
import { hasAnthropicKey } from "@/lib/llm/client";
import { openPassage } from "@/lib/reader/passages";
import { Reader } from "./reader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function PassagePage({ params, searchParams }: PageProps<"/read/[id]">) {
  const { id } = await params;
  const { reused } = await searchParams;
  if (!hasDatabase() || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await openPassage(db(), id);
  if (!view) notFound();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:py-12">
      <header className="flex items-baseline justify-between gap-4 text-sm">
        <Link href="/read" className="text-muted underline">
          Read
        </Link>
        <span className="text-muted tabular-nums">
          {Math.round(view.coverage * 100)}% known · {view.unknownCount} new {view.unknownCount === 1 ? "word" : "words"}
        </span>
      </header>
      {reused === "1" && <p className="mt-3 text-xs text-muted">From your library: this passage fits what you know today.</p>}
      {view.title && <h1 className="mt-4 text-lg font-medium">{view.title}</h1>}
      {view.sourceRef && (
        <a href={view.sourceRef} className="mt-1 block truncate text-xs text-muted underline" target="_blank" rel="noreferrer">
          {view.sourceRef}
        </a>
      )}
      <Reader view={view} canGloss={hasAnthropicKey()} />
    </main>
  );
}
