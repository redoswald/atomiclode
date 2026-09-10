/**
 * Server-side URL import: fetch the page, extract the article body with
 * Readability, and return plain text with paragraph breaks preserved.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface FetchedArticle {
  title?: string;
  text: string;
  sourceRef: string;
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export async function fetchArticle(rawUrl: string): Promise<FetchedArticle> {
  const url = validateUrl(rawUrl);
  const res = await fetch(url, {
    headers: { "user-agent": "Lode/0.1 (+https://github.com/redoswald/atomiclode)", accept: "text/html,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The page responded ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error("That page is too large to import.");
  const raw = new TextDecoder(charsetOf(type)).decode(buf);

  if (!/html/i.test(type) && !/^\s*</.test(raw)) {
    return { text: cleanText(raw), sourceRef: url.toString() };
  }

  const { document } = parseHTML(raw);
  const article = new Readability(document as unknown as Document).parse();
  const text = article?.textContent ? cleanText(article.textContent) : cleanText(document.body?.textContent ?? "");
  if (text.split(/\s+/).length < 20) throw new Error("Couldn't find an article body on that page. Try pasting the text.");
  return { title: article?.title || document.title || undefined, text, sourceRef: url.toString() };
}

export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs can be imported.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host.startsWith("[")
  ) {
    throw new Error("That address isn't reachable from the server.");
  }
  return url;
}

function charsetOf(contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType);
  try {
    new TextDecoder(m?.[1] ?? "utf-8");
    return m?.[1] ?? "utf-8";
  } catch {
    return "utf-8";
  }
}

/** Collapse runs of spaces, keep paragraph breaks, drop very short lines (nav, captions). */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n")
    .trim();
}
