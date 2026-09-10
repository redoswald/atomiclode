/**
 * Passage analysis entry point. Uses the spaCy service when NLP_SERVICE_URL is
 * set (better lemmas in context), otherwise the built-in lookup tokenizer.
 * Both return the same token contract: pre + surface reproduces the text.
 */
import { normalizeForm } from "./lexicon";
import { analyzeLocal, type Analysis, type Token } from "./tokenize";

export type AnalysisSource = "local" | "spacy";

export interface AnalysisResult extends Analysis {
  source: AnalysisSource;
}

export function nlpServiceConfigured(): boolean {
  return Boolean(process.env.NLP_SERVICE_URL);
}

export async function analyzeText(text: string): Promise<AnalysisResult> {
  if (nlpServiceConfigured()) {
    try {
      return { ...(await analyzeRemote(text)), source: "spacy" };
    } catch (err) {
      console.warn("NLP service failed; falling back to local analysis:", err instanceof Error ? err.message : err);
    }
  }
  return { ...analyzeLocal(text), source: "local" };
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
  const tokens: Token[] = data.tokens.map((t) => ({
    pre: t.pre ?? "",
    surface: t.surface,
    lemma: t.isWord ? normalizeForm(t.lemma || t.surface) : "",
    isWord: Boolean(t.isWord),
    sentenceIdx: t.sentenceIdx,
  }));
  const rebuilt = tokens.map((t) => t.pre + t.surface).join("");
  if (rebuilt !== text.replace(/\r\n?/g, "\n")) throw new Error("NLP service tokens do not reproduce the text");
  return { sentences: data.sentences, tokens };
}
