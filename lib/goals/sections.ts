/** Splitting a long goal text into readable sections (SPEC §11 "On pinning"). Pure. */
import { splitSentences } from "@/lib/reader/tokenize";

export const SECTION_MAX_WORDS = 300;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * Sections of at most ~maxWords, cut at paragraph boundaries; a paragraph that is
 * too long on its own is cut at sentence boundaries. Nothing is dropped or reordered.
 */
export function sectionize(text: string, maxWords = SECTION_MAX_WORDS): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (words(p) <= maxWords ? [p] : packSentences(splitSentences(p), maxWords)));

  const sections: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    const n = words(p);
    if (current.length && count + n > maxWords) {
      sections.push(current.join("\n\n"));
      current = [];
      count = 0;
    }
    current.push(p);
    count += n;
  }
  if (current.length) sections.push(current.join("\n\n"));
  return sections;
}

function packSentences(sentences: string[], maxWords: number): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const n = words(s);
    if (current.length && count + n > maxWords) {
      out.push(current.join(" "));
      current = [];
      count = 0;
    }
    current.push(s);
    count += n;
  }
  if (current.length) out.push(current.join(" "));
  return out;
}
