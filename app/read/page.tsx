import Link from "next/link";
import { generateOrReuse } from "@/app/actions/generate";
import { importPassage } from "@/app/actions/reader";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { hasAnthropicKey } from "@/lib/llm/client";
import { GENRES } from "@/lib/llm/generate";
import { nlpServiceConfigured } from "@/lib/reader/analyze";
import { listPassages } from "@/lib/reader/passages";
import { readingMinutes } from "@/lib/reader/reading";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ReadPage({ searchParams }: PageProps<"/read">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const list = hasDatabase() ? await listPassages(db()) : [];
  const hasKey = hasAnthropicKey();

  return (
    <Shell title="Read" eyebrow="Articles. Ideas. A richer you.">
      <form action={importPassage} className="card flex flex-col gap-3 p-5">
        <h2 className="font-display text-2xl">Import</h2>
        <input name="url" type="url" inputMode="url" placeholder="Article URL" className="field text-base" />
        <p className="text-center text-xs text-muted">or paste text</p>
        <textarea name="text" rows={5} lang="fr" placeholder="Collez un texte en français…" className="field text-base" />
        <input name="title" placeholder="Title (optional)" className="field text-sm" />
        {error && <p className="text-sm text-bad">{error}</p>}
        <button type="submit" className="btn-primary">
          Create reading passage →
        </button>
        <p className="text-xs text-muted">
          Analysed with {nlpServiceConfigured() ? "the spaCy service" : "the built-in lemmatizer"}. New words enter your queue
          only if you mine them.
        </p>
      </form>

      <form action={generateOrReuse} className="card mt-6 flex flex-col gap-3 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Generate</h2>
          <span className="eyebrow">Reuses a fitting passage first</span>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Genre</span>
          <select name="genre" defaultValue="short story" className="field py-1.5">
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <input name="topic" placeholder="Topic or place (optional): un marché à Lyon, mon trajet en train…" className="field text-sm" />
        <label className="text-sm">
          <span className="flex justify-between">
            <span>Stretch</span>
            <span className="text-muted">98% known ↔ 90% known</span>
          </span>
          <input name="stretch" type="range" min={90} max={98} step={1} defaultValue={95} className="mt-1 w-full" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="includeDue" type="checkbox" defaultChecked />
          Work in words that are due for review
        </label>
        <button type="submit" className="btn-secondary">
          Read something new
        </button>
        {!hasKey && (
          <p className="text-xs text-muted">
            Without <code className="font-mono">ANTHROPIC_API_KEY</code> this only serves passages already in the library.
          </p>
        )}
      </form>

      {list.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow">Passages</h2>
          <ul className="mt-2 divide-y divide-line">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/read/${p.id}`} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="truncate">
                    {p.title ?? "Untitled"}
                    {p.origin === "generated" && <span className="ml-2 text-xs text-muted">{p.sourceRef?.startsWith("passage:") ? "adapted" : "generated"}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {Math.round(p.coverage * 100)}% · {readingMinutes(p.wordCount)} min{p.reads > 0 && ` · read ${p.reads}×`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
