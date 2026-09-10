"use client";

import { Fragment, useMemo, useState } from "react";
import { alreadyKnow, mine, tapWord } from "@/app/actions/reader";
import { WhyPanel } from "@/app/why-panel";
import type { PassageView, ViewToken } from "@/lib/reader/passages";

type LemmaState = "unknown" | "queued" | "known";

interface Selection {
  index: number;
  token: ViewToken;
  gloss?: string;
  lemmaGloss?: string;
  loading: boolean;
  error?: string;
}

export function Reader({ view, canGloss }: { view: PassageView; canGloss: boolean }) {
  // Local overrides after mining / marking known, keyed by lemma.
  const [overrides, setOverrides] = useState<Record<string, LemmaState>>({});
  const [sel, setSel] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);

  const stateOf = (t: ViewToken): LemmaState => {
    if (!t.isWord) return "known";
    const o = overrides[t.lemma];
    if (o) return o;
    if (t.known) return "known";
    return "unknown";
  };

  const unknownInSentence = useMemo(() => {
    const counts = new Map<number, Set<string>>();
    for (const t of view.tokens) {
      if (!t.isWord || stateOf(t) === "known") continue;
      if (!counts.has(t.sentenceIdx)) counts.set(t.sentenceIdx, new Set());
      counts.get(t.sentenceIdx)!.add(t.lemma);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.tokens, overrides]);

  async function select(index: number) {
    const token = view.tokens[index];
    if (!token.isWord) return;
    const sentence = view.sentences[token.sentenceIdx] ?? "";
    setSel({ index, token, gloss: token.gloss || undefined, loading: canGloss, error: undefined });
    if (!canGloss) return;
    const r = await tapWord({ passageId: view.id, atomId: token.atomId, lemma: token.lemma, surface: token.surface, sentence });
    setSel((s) =>
      s && s.index === index ? { ...s, loading: false, gloss: r.gloss ?? s.gloss, lemmaGloss: r.lemmaGloss, error: r.error } : s,
    );
  }

  async function doMine() {
    if (!sel) return;
    setBusy(true);
    try {
      await mine({
        passageId: view.id,
        sentenceIdx: sel.token.sentenceIdx,
        lemma: sel.token.lemma,
        surface: sel.token.surface,
        gloss: sel.lemmaGloss ?? sel.gloss ?? "",
      });
      setOverrides((o) => ({ ...o, [sel.token.lemma]: "queued" }));
      setSel(null);
    } catch (err) {
      setSel((s) => (s ? { ...s, error: err instanceof Error ? err.message : String(err) } : s));
    } finally {
      setBusy(false);
    }
  }

  async function doKnow() {
    if (!sel) return;
    setBusy(true);
    try {
      await alreadyKnow({ lemma: sel.token.lemma, surface: sel.token.surface, gloss: sel.lemmaGloss ?? sel.gloss ?? "" });
      setOverrides((o) => ({ ...o, [sel.token.lemma]: "known" }));
      setSel(null);
    } catch (err) {
      setSel((s) => (s ? { ...s, error: err instanceof Error ? err.message : String(err) } : s));
    } finally {
      setBusy(false);
    }
  }

  const selState = sel ? stateOf(sel.token) : "known";
  const selUnknowns = sel ? (unknownInSentence.get(sel.token.sentenceIdx)?.size ?? 0) : 0;

  return (
    <>
      <article className="mt-6 whitespace-pre-wrap text-lg leading-8" lang="fr">
        {view.tokens.map((t, i) => {
          if (!t.isWord) {
            return (
              <Fragment key={i}>
                {t.pre}
                {t.surface}
              </Fragment>
            );
          }
          const state = stateOf(t);
          const active = sel?.index === i;
          const cls =
            state === "unknown"
              ? "underline decoration-dotted decoration-1 underline-offset-4"
              : state === "queued"
                ? "underline decoration-1 underline-offset-4 decoration-foreground/40"
                : "";
          return (
            <Fragment key={i}>
              {t.pre}
              <button
                type="button"
                onClick={() => select(i)}
                className={`rounded-sm ${cls} ${active ? "bg-foreground/10" : ""}`}
              >
                {t.surface}
              </button>
            </Fragment>
          );
        })}
      </article>

      {sel && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-background p-5 shadow-lg" role="dialog">
          <div className="mx-auto max-w-xl">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-2xl">
                {sel.token.surface}
                {sel.token.lemma !== sel.token.surface.toLowerCase() && (
                  <span className="ml-2 text-base text-muted">{sel.token.lemma}</span>
                )}
              </p>
              <button onClick={() => setSel(null)} className="text-sm text-muted underline">
                Close
              </button>
            </div>
            <p className="mt-1 min-h-6 text-base">
              {sel.gloss ?? (sel.loading ? <span className="text-muted">…</span> : <span className="text-muted">no meaning yet</span>)}
              {sel.lemmaGloss && sel.lemmaGloss !== sel.gloss && <span className="ml-2 text-sm text-muted">({sel.lemmaGloss})</span>}
            </p>
            {sel.error && <p className="mt-1 text-xs text-muted">{sel.error}</p>}
            <p className="mt-3 text-sm text-muted" lang="fr">
              <SentenceWithMark sentence={view.sentences[sel.token.sentenceIdx] ?? ""} surface={sel.token.surface} />
            </p>
            {selState === "unknown" && selUnknowns >= 3 && (
              <p className="mt-2 text-xs text-muted">
                This sentence has {selUnknowns} new words; the cloze card will be harder.
              </p>
            )}
            <WhyPanel
              key={sel.index}
              request={{
                atomId: sel.token.atomId,
                lemma: sel.token.lemma,
                surface: sel.token.surface,
                sentence: view.sentences[sel.token.sentenceIdx] ?? "",
              }}
              canWhy={canGloss}
              className="mt-3"
            />
            <div className="mt-4 flex gap-2 text-sm">
              {selState === "unknown" && (
                <>
                  <button onClick={doMine} disabled={busy} className="rounded-md bg-foreground px-3 py-2 text-background disabled:opacity-50">
                    Mine
                  </button>
                  <button onClick={doKnow} disabled={busy} className="rounded-md border border-line px-3 py-2 disabled:opacity-50">
                    Already know
                  </button>
                </>
              )}
              {selState === "queued" && <span className="py-2 text-muted">Queued for review.</span>}
              {selState === "known" && sel.token.isWord && <span className="py-2 text-muted">In your reviews.</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SentenceWithMark({ sentence, surface }: { sentence: string; surface: string }) {
  const i = sentence.indexOf(surface);
  if (i < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, i)}
      <mark className="rounded-sm bg-foreground/10 px-0.5 text-foreground">{surface}</mark>
      {sentence.slice(i + surface.length)}
    </>
  );
}
