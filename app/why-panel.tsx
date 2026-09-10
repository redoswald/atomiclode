"use client";

import { useState } from "react";
import { addGrammar, why, type WhyResponse } from "@/app/actions/why";
import type { WhyRequest } from "@/lib/reader/why";

/**
 * The "Why?" link (SPEC §7). Fetches an explanation on demand, shows it inline,
 * and offers to add a grammar atom when the model names one.
 */
export function WhyPanel({
  request,
  cached,
  canWhy,
  className = "",
}: {
  request: WhyRequest;
  /** A generic explanation already on the atom, shown without a request. */
  cached?: string;
  canWhy: boolean;
  className?: string;
}) {
  const [answer, setAnswer] = useState<WhyResponse | undefined>(cached ? { explanation: cached, cached: true } : undefined);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  async function ask() {
    setOpen(true);
    if (answer || loading) return;
    setLoading(true);
    setAnswer(await why(request));
    setLoading(false);
  }

  async function add() {
    if (!answer || "error" in answer || !answer.grammar) return;
    await addGrammar({
      key: answer.grammar.key,
      title: answer.grammar.title,
      explanation: answer.grammar.explanation,
      fromAtomId: request.atomId,
    });
    setAdded(true);
  }

  if (!canWhy && !cached) return null;

  return (
    <div className={`text-sm ${className}`}>
      {!open ? (
        <button onClick={ask} className="text-muted underline">
          Why?
        </button>
      ) : loading || !answer ? (
        <p className="text-muted">Thinking…</p>
      ) : "error" in answer ? (
        <p className="text-muted">{answer.error}</p>
      ) : (
        <div>
          <p className="leading-6">{answer.explanation}</p>
          {answer.grammar && (
            <p className="mt-2 text-muted">
              {answer.grammar.existing ? (
                <>
                  Grammar: <em>{answer.grammar.title}</em> (in your reviews)
                </>
              ) : added ? (
                <>
                  Added <em>{answer.grammar.title}</em> to your reviews.
                </>
              ) : (
                <>
                  Add <em>{answer.grammar.title}</em> to your reviews?{" "}
                  <button onClick={add} className="underline">
                    Add
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
