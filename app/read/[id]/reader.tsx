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
  translation?: string;
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
      s && s.index === index
        ? { ...s, loading: false, gloss: r.gloss ?? s.gloss, lemmaGloss: r.lemmaGloss, translation: r.translation, error: r.error }
        : s,
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
  const sentence = sel ? (view.sentences[sel.token.sentenceIdx] ?? "") : "";

  return (
    <>
      <article className="font-display mt-6 whitespace-pre-wrap text-[1.35rem] leading-9" lang="fr">
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
              ? "underline decoration-dotted decoration-1 underline-offset-[5px] decoration-muted"
              : state === "queued"
                ? "rounded-sm bg-tint-sage"
                : "";
          return (
            <Fragment key={i}>
              {t.pre}
              <button type="button" onClick={() => select(i)} className={`rounded-sm ${cls} ${active ? "bg-tint-moss" : ""}`}>
                {t.surface}
              </button>
            </Fragment>
          );
        })}
      </article>

      {sel && (
        <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-card p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl" role="dialog">
          <div className="mx-auto max-w-xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-3xl leading-none">{sel.token.surface}</p>
                <p className="mt-1 text-sm text-muted">
                  {sel.token.lemma !== sel.token.surface.toLowerCase() ? `form of ${sel.token.lemma}` : sel.token.lemma}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sel.token.pos && <span className="rounded-full bg-tint-sage px-2.5 py-1 text-xs">{sel.token.pos.toLowerCase()}</span>}
                <button onClick={() => setSel(null)} className="text-sm text-muted underline">
                  Close
                </button>
              </div>
            </div>
            <p className="mt-2 min-h-6 text-lg">
              {sel.gloss ?? (sel.loading ? <span className="text-muted">…</span> : <span className="text-muted">no meaning yet</span>)}
              {sel.lemmaGloss && sel.lemmaGloss !== sel.gloss && <span className="ml-2 text-sm text-muted">({sel.lemmaGloss})</span>}
            </p>
            {sel.error && <p className="mt-1 text-xs text-muted">{sel.error}</p>}

            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm" lang="fr">
                <SentenceWithMark sentence={sentence} surface={sel.token.surface} />
              </p>
              {sel.translation && <p className="mt-1 text-sm italic text-muted">{sel.translation}</p>}
              {selState === "unknown" && selUnknowns >= 3 && (
                <p className="mt-2 text-xs text-muted">This sentence has {selUnknowns} new words; the cloze card will be harder.</p>
              )}
            </div>

            <WhyPanel
              key={sel.index}
              request={{ atomId: sel.token.atomId, lemma: sel.token.lemma, surface: sel.token.surface, sentence }}
              canWhy={canGloss}
              className="mt-3"
            />

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {selState === "unknown" ? (
                <>
                  <button onClick={doMine} disabled={busy} className="btn-primary">
                    Mine
                  </button>
                  <button onClick={doKnow} disabled={busy} className="btn-secondary">
                    Already know
                  </button>
                </>
              ) : (
                <p className="col-span-2 py-2 text-muted">{selState === "queued" ? "Queued for review." : "In your reviews."}</p>
              )}
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
      <mark className="rounded-sm bg-tint-sage px-0.5 text-ink">{surface}</mark>
      {sentence.slice(i + surface.length)}
    </>
  );
}
