import Link from "next/link";
import { generateOrReuse } from "@/app/actions/generate";
import { importPassage } from "@/app/actions/reader";
import { hasAnthropicKey } from "@/lib/llm/client";
import { GENRES } from "@/lib/llm/generate";
import { db, hasDatabase } from "@/db";
import { nlpServiceConfigured } from "@/lib/reader/analyze";
import { listPassages } from "@/lib/reader/passages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ReadPage({ searchParams }: PageProps<"/read">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const list = hasDatabase() ? await listPassages(db()) : [];

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-medium">Read</h1>
        <Link href="/" className="text-sm text-muted underline">
          Home
        </Link>
      </header>

      <form action={importPassage} className="mt-6 flex flex-col gap-3">
        <input
          name="url"
          type="url"
          inputMode="url"
          placeholder="Article URL"
          className="rounded-md border border-line bg-transparent px-3 py-2 text-base outline-none focus:border-foreground"
        />
        <p className="text-center text-xs text-muted">or paste text</p>
        <textarea
          name="text"
          rows={6}
          lang="fr"
          placeholder="Collez un texte en français…"
          className="rounded-md border border-line bg-transparent px-3 py-2 text-base outline-none focus:border-foreground"
        />
        <input
          name="title"
          placeholder="Title (optional)"
          className="rounded-md border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" className="rounded-md bg-foreground py-2.5 text-background">
          Import
        </button>
        <p className="text-xs text-muted">
          Analysed with {nlpServiceConfigured() ? "the spaCy service" : "the built-in lemmatizer"}. Unknown words get
          underlined; tap one to see its meaning and add it to your reviews.
        </p>
      </form>

      <form action={generateOrReuse} className="mt-10 flex flex-col gap-3 rounded-md border border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Generate</h2>
          <span className="text-xs text-muted">reuses a fitting passage first</span>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Genre</span>
          <select name="genre" defaultValue="short story" className="rounded-md border border-line bg-transparent px-2 py-1.5">
            {GENRES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <input
          name="topic"
          placeholder="Topic or place (optional): un marché à Lyon, mon trajet en train…"
          className="rounded-md border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground"
        />
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
        <button type="submit" className="rounded-md bg-foreground py-2.5 text-background">
          Read something new
        </button>
        {!hasAnthropicKey() && (
          <p className="text-xs text-muted">
            Without <code className="font-mono">ANTHROPIC_API_KEY</code> this only serves passages already in the library.
          </p>
        )}
      </form>

      {list.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium text-muted">Passages</h2>
          <ul className="mt-2 divide-y divide-line">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/read/${p.id}`} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="truncate">{p.title ?? "Untitled"}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {Math.round(p.coverage * 100)}% known · {p.wordCount} words
                    {p.reads > 0 && ` · read ${p.reads}×`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
