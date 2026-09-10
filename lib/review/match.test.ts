import { describe, expect, it } from "vitest";
import { lenientMatch, normalizeAnswer } from "./match";

describe("lenientMatch", () => {
  it("ignores case, accents, and punctuation", () => {
    expect(lenientMatch("Etre!", ["être"])).toBe(true);
    expect(lenientMatch("  MARCHÉ ", ["marché"])).toBe(true);
    expect(lenientMatch("coeur", ["cœur"])).toBe(true);
  });
  it("ignores leading articles and clitics", () => {
    expect(lenientMatch("le marché", ["marché"])).toBe(true);
    expect(lenientMatch("l'eau", ["eau"])).toBe(true);
    expect(lenientMatch("se lever", ["lever"])).toBe(true);
    expect(lenientMatch("un café", ["café"])).toBe(true);
  });
  it("accepts any listed form", () => {
    expect(lenientMatch("voudrais", ["vouloir", "voudrais", "veux"])).toBe(true);
    expect(lenientMatch("je voudrais", ["je voudrais"])).toBe(true);
  });
  it("rejects wrong answers and empty input", () => {
    expect(lenientMatch("vouloir", ["pouvoir"])).toBe(false);
    expect(lenientMatch("", ["pouvoir"])).toBe(false);
    expect(lenientMatch("le", ["le"])).toBe(true);
  });
  it("normalizes predictably", () => {
    expect(normalizeAnswer("S'il vous plaît")).toBe("il vous plait");
  });
});
