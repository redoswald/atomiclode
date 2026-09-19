import { describe, expect, it } from "vitest";
import grammar from "@/db/seed/grammar-fr.json";
import scenarios from "@/db/seed/scenarios-fr.json";
import { validateScenarios, type ScenarioEntry } from "./seed";

describe("seed scenarios", () => {
  it("every bundle atom is in its dialogue, every prompt target is taught and used", () => {
    const problems = validateScenarios(scenarios as ScenarioEntry[], new Set(grammar.map((g) => g.key)));
    expect(problems).toEqual([]);
  });

  it("covers a dozen situations", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
  });
});
