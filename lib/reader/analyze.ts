/**
 * Passage analysis entry point. French can use the spaCy service when
 * NLP_SERVICE_URL is set (better lemmas in context); otherwise, and always for
 * Greek, the built-in tokenizer runs with the language's lexicon.
 * Both return the same token contract: pre + surface reproduces the text.
 */
import { normalizeFor, type Lang } from "@/lib/lang";
import type { Lexicon } from "./lexicon";
import { analyzeLocal, type Analysis, type Token } from "./tokenize";

export type AnalysisSource = "local" | "spacy";

export interface AnalysisResult extends Analysis {
  source: AnalysisSource;
}

export function nlpServiceConfigured(): boolean {
  return Boolean(process.env.NLP_SERVICE_URL);
}

export async function analyzeText(text: string, opts: { lang?: Lang; lexicon?: Lexicon } = {}): Promise<AnalysisResult> {
  const lang = opts.lang ?? "fr";
  if (lang === "fr" && nlpServiceConfigured()) {
    try {
      return { ...(await analyzeRemote(text)), source: "spacy" };
    } catch (err) {
      console.warn("NLP service failed; falling back to local analysis:", err instanceof Error ? err.message : err);
    }
  }
  return { ...analyzeLocal(text, { lang, lexicon: opts.lexicon }), source: "local" };
}

interface RemoteToken {
  pre: string;
  surface: string;
  lemma: string;
  isWord: boolean;
  sentenceIdx: number;
}

async function analyzeRemote(text: string): Promise<Analysis> {
  const base = process.env.NLP_SERVICE_URL!.replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.NLP_SERVICE_TOKEN) headers.authorization = `Bearer ${process.env.NLP_SERVICE_TOKEN}`;
  const res = await fetch(`${base}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NLP service responded ${res.status}`);
  const data = (await res.json()) as { sentences: string[]; tokens: RemoteToken[] };
  if (!Array.isArray(data.sentences) || !Array.isArray(data.tokens)) throw new Error("NLP service returned an unexpected shape");
  const normalize = normalizeFor("fr");
  const tokens: Token[] = data.tokens.map((t) => ({
    pre: t.pre ?? "",
    surface: t.surface,
    lemma: t.isWord ? normalize(t.lemma || t.surface) : "",
    isWord: Boolean(t.isWord),
    sentenceIdx: t.sentenceIdx,
  }));
  const rebuilt = tokens.map((t) => t.pre + t.surface).join("");
  if (rebuilt !== text.replace(/\r\n?/g, "\n")) throw new Error("NLP service tokens do not reproduce the text");
  return { sentences: data.sentences, tokens };
}
