import { describe, expect, it } from "vitest";
import { matchChunks } from "./chunks";
import { analyzeLocal, splitSentences, wordTokens } from "./tokenize";

describe("splitSentences", () => {
  it("splits on terminal punctuation followed by a capital, and on paragraphs", () => {
    expect(splitSentences("Je voudrais un café. Il fait beau! Tu viens ? oui.\n\nNouveau paragraphe")).toEqual([
      "Je voudrais un café.",
      "Il fait beau!",
      "Tu viens ? oui.",
      "Nouveau paragraphe",
    ]);
  });
  it("keeps decimals and closing quotes with their sentence", () => {
    expect(splitSentences("« Bonjour ! » dit-elle. Il a 3.5 kg.")).toEqual(["« Bonjour ! » dit-elle.", "Il a 3.5 kg."]);
  });
});

describe("analyzeLocal", () => {
  it("lemmatizes, splits elisions, and reproduces the text exactly", () => {
    const text = "Je voudrais un café, s'il vous plaît. L'homme est parti hier.";
    const { sentences, tokens } = analyzeLocal(text);
    expect(sentences).toHaveLength(2);
    expect(tokens.map((t) => t.pre + t.surface).join("")).toBe(text);
    const words = wordTokens(tokens);
    expect(words.map((t) => t.lemma)).toEqual([
      "je", "vouloir", "un", "café", "si", "il", "vous", "plaire", "le", "homme", "être", "partir", "hier",
    ]);
    expect(words.map((t) => t.sentenceIdx)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it("handles curly apostrophes, œ, contractions, and hyphens", () => {
    const text = "Qu’est-ce que tu fais au cœur des yeux ? Dis-moi, peut-être aujourd'hui.";
    const { tokens } = analyzeLocal(text);
    expect(tokens.map((t) => t.pre + t.surface).join("")).toBe(text);
    expect(wordTokens(tokens).map((t) => t.lemma)).toEqual([
      "que", "être", "ce", "que", "tu", "faire", "à", "coeur", "un", "oeil", "dire", "moi", "peut-être", "aujourd'hui",
    ]);
  });

  it("treats capitalized unknown words mid-sentence as names, not words", () => {
    const { tokens } = analyzeLocal("Hier, Marie et Jean-Pierre sont allés à Lyon. Paris est belle.");
    const names = tokens.filter((t) => !t.isWord && /^[A-Z]/.test(t.surface)).map((t) => t.surface);
    expect(names).toEqual(["Marie", "Jean", "Pierre", "Lyon"]);
    const words = wordTokens(tokens).map((t) => t.surface);
    expect(words).toContain("Hier");
    expect(words).toContain("Paris");
  });

  it("keeps punctuation and paragraph breaks", () => {
    const text = "Bonjour.\n\nÇa va ?";
    const { tokens } = analyzeLocal(text);
    expect(tokens.map((t) => t.pre + t.surface).join("")).toBe(text);
    expect(tokens.find((t) => t.surface === "Ça")?.pre).toBe("\n\n");
    expect(tokens.find((t) => t.surface === "?")?.pre).toBe(" ");
  });

  it("survives odd input", () => {
    expect(analyzeLocal("").tokens).toEqual([]);
    expect(analyzeLocal("   \n\n  ").sentences).toEqual([]);
    const { tokens } = analyzeLocal("...!!! 123 --");
    expect(wordTokens(tokens)).toEqual([]);
  });
});

describe("matchChunks", () => {
  it("matches the longest chunk within a sentence", () => {
    const { tokens } = analyzeLocal("Je voudrais un café, s'il vous plaît. Il y a du monde.");
    const m = matchChunks(tokens, ["je voudrais", "je voudrais un café", "s'il vous plaît", "il y a"]);
    expect(new Set(m.values())).toEqual(new Set(["je voudrais un café", "s'il vous plaît", "il y a"]));
    const covered = [...m.keys()].sort((a, b) => a - b).map((i) => tokens[i].surface);
    expect(covered).toEqual(["Je", "voudrais", "un", "café", "s'", "il", "vous", "plaît", "Il", "y", "a"]);
  });
  it("splits verb–pronoun hyphens but keeps lexical compounds", () => {
    const words = wordTokens(analyzeLocal("Va-t-il au rendez-vous là-bas ? Allons-y.").tokens);
    expect(words.map((t) => t.surface)).toEqual(["Va", "t", "il", "au", "rendez-vous", "là-bas", "Allons", "y"]);
  });
  it("does not match across sentences", () => {
    const { tokens } = analyzeLocal("Il y. A du monde.");
    expect(matchChunks(tokens, ["il y a"]).size).toBe(0);
  });
});
