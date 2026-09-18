/**
 * Integration: seed the scenarios into in-memory Postgres, open the café, see its
 * bundle lead the review queue with cloze lines from the dialogue, absorb it, and
 * write visit 2 with a fake model.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, passages, producePrompts, scenarios, scenarioVisits, sentences } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import seedFile from "@/db/seed/scenarios-fr.json";
import { seedAtoms } from "@/db/seed/run";
import { seedScenarios } from "@/db/seed/scenarios";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import type { GeneratedVisit } from "@/lib/llm/scenario";
import { openPassage } from "@/lib/reader/passages";
import { buildSession } from "@/lib/review/session";
import { createCustomScenario, generateNextVisit } from "./generate";
import type { ScenarioEntry } from "./seed";
import { scenarioStates, startVisit, suggestVisit } from "./visits";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-20T12:00:00Z");
const ENTRIES = seedFile as ScenarioEntry[];

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: freq as FrequencyEntry[], chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
}, 60_000);

afterAll(async () => {
  await client.close();
});

const cafe = async () => {
  const [s] = await d.select().from(scenarios).where(eq(scenarios.slug, "cafe"));
  const [v] = await d.select().from(scenarioVisits).where(eq(scenarioVisits.scenarioId, s.id));
  return { scenario: s, visit: v };
};

const VISIT_2: GeneratedVisit = {
  title: "Le café",
  brief: "They got your order wrong. Sort it out politely.",
  summary: "The coffee came with milk by mistake; asked for a black one instead.",
  dialogue:
    "— Bonjour ! Voilà votre café crème.\n— Pardon, mais ce n'est pas mon café. Je voudrais un café noir, sans lait.\n— Oh, pardon ! Un café noir, tout de suite.\n— Merci. Ce n'est pas grave.\n— Voilà, un café noir. Vous voulez du sucre ?\n— Non merci, sans sucre.",
  translation: "— Hello! Here's your coffee with milk.\n— Sorry, but that's not my coffee. I'd like a black coffee, without milk.\n— Oh, sorry! A black coffee, right away.\n— Thanks. It's no big deal.\n— Here you go, a black coffee. Would you like sugar?\n— No thanks, no sugar.",
  bundle: [
    { type: "chunk", key: "ce n'est pas grave", gloss: "it's no big deal" },
    { type: "word", key: "pardon", gloss: "sorry, excuse me" },
    { type: "word", key: "sans", gloss: "without" },
    { type: "word", key: "lait", gloss: "milk" },
    { type: "word", key: "sucre", gloss: "sugar" },
    { type: "word", key: "licorne", gloss: "unicorn" }, // promised, never used: must be dropped
    { type: "word", key: "café", gloss: "coffee" }, // already being learned: not part of the bundle
  ],
  grammarKey: "negation-ne-pas",
  prompts: [{ situation: "The waiter brings a coffee with milk; you ordered black. Tell him, kindly.", exampleAnswer: "Pardon, je voudrais un café sans lait.", targets: ["pardon", "sans", "lait"] }],
};

describe("scenarios", () => {
  it("seeds a dozen scenarios with their first visit, idempotently", async () => {
    const first = await seedScenarios(d, ENTRIES, NOW);
    expect(first).toEqual({ scenarios: ENTRIES.length, visitsWritten: ENTRIES.length });
    const again = await seedScenarios(d, ENTRIES, NOW);
    expect(again.visitsWritten).toBe(0);

    const { visit } = await cafe();
    expect(visit.bundle).toHaveLength(9);
    expect(visit.translation).toContain("I'd like a coffee");
    const [p] = await d.select().from(passages).where(eq(passages.id, visit.passageId!));
    expect(p.origin).toBe("scenario");
    const prompts = await d.select().from(producePrompts).where(eq(producePrompts.visitId, visit.id));
    expect(prompts).toHaveLength(2);
    expect(prompts.every((x) => x.targetAtomIds.length > 0)).toBe(true);
    // A frequency-list word keeps its rank; its empty gloss is filled from the bundle.
    const [word] = await d.select().from(atoms).where(sql`${atoms.type} = 'word' and ${atoms.key} = 'café'`);
    expect(word.frequencyRank).not.toBeNull();
    expect(word.gloss).not.toBe("");
  });

  it("offers the first scenario, and holds the bare frequency list back while scenarios lead", async () => {
    const states = await scenarioStates(d);
    expect(states.every((s) => s.state === "ready")).toBe(true);
    expect(suggestVisit(states, false)?.scenario.slug).toBe("arriving");
    // Nothing opened yet: no new atoms at all, rather than "de, la, et".
    const session = await buildSession(d, "steady", NOW, { produce: false });
    expect(session.cards).toHaveLength(0);
  });

  it("opening a visit puts its bundle at the head of the queue, with lines from the dialogue as sentences", async () => {
    const { visit } = await cafe();
    await startVisit(d, visit.id, NOW);
    await startVisit(d, visit.id, new Date(NOW.getTime() + 1000)); // idempotent
    const [started] = await d.select().from(scenarioVisits).where(eq(scenarioVisits.id, visit.id));
    expect(new Date(started.startedAt!).getTime()).toBe(NOW.getTime());

    const bundle = await d.select().from(atoms).where(inArray(atoms.id, visit.bundle));
    expect(bundle.filter((a) => a.frequencyRank !== null).every((a) => a.source === "scenario")).toBe(true);
    const lines = await d.select().from(sentences).where(eq(sentences.passageId, visit.passageId!));
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((l) => l.origin === "scenario")).toBe(true);

    const session = await buildSession(d, "steady", NOW, { produce: false });
    expect(session.cards.map((c) => c.atomId)).toEqual(visit.bundle);
    expect(session.cards[0].key).toBe("je voudrais");

    const states = await scenarioStates(d);
    expect(states.find((s) => s.scenario.slug === "cafe")?.state).toBe("learning");
    expect(suggestVisit(states, true)).toBeUndefined();

    // The dialogue reads like any passage.
    const view = (await openPassage(d, visit.passageId!, NOW))!;
    expect(view.origin).toBe("scenario");
    expect(view.tokens.some((t) => t.chunkKey === "à emporter")).toBe(true);
  });

  it("once the bundle is absorbed, writes the next visit from the model's answer, dropping what it got wrong", async () => {
    const { scenario, visit } = await cafe();
    await expect(generateNextVisit(d, (await d.select().from(scenarios).where(eq(scenarios.slug, "bakery")))[0].id, { generate: async () => VISIT_2 })).rejects.toThrow(/haven't opened/);

    await d.update(atoms).set({ status: "learning", stability: 1, reps: 1 }).where(inArray(atoms.id, visit.bundle));
    const states = await scenarioStates(d);
    expect(states.find((s) => s.scenario.slug === "cafe")?.state).toBe("next");
    // Unopened seed visits are offered before one that has to be written.
    expect(suggestVisit(states, true)?.scenario.slug).toBe("arriving");

    let asked: Parameters<NonNullable<Parameters<typeof generateNextVisit>[2]>["generate"] & object>[0] | undefined;
    const { visitId, n } = await generateNextVisit(d, scenario.id, {
      goalLemmas: ["naître", "café"],
      now: NOW,
      generate: async (input) => {
        asked = input;
        return VISIT_2;
      },
    });
    expect(n).toBe(2);
    expect(asked!.earlier).toEqual([ENTRIES.find((e) => e.slug === "cafe")!.visit.summary]);
    expect(asked!.known).toContain("café");
    expect(asked!.candidates).toContain("naître");
    expect(asked!.candidates).not.toContain("café");

    const [v2] = await d.select().from(scenarioVisits).where(eq(scenarioVisits.id, visitId));
    const keys = (await d.select({ key: atoms.key }).from(atoms).where(inArray(atoms.id, v2.bundle))).map((r) => r.key).sort();
    expect(keys).toEqual(["ce n'est pas grave", "lait", "negation-ne-pas", "pardon", "sans", "sucre"].sort());
    const [prompt] = await d.select().from(producePrompts).where(eq(producePrompts.visitId, visitId));
    expect(prompt.targetAtomIds).toHaveLength(3);
  });

  it("makes a scenario from the learner's own words, and cleans up when the model fails", async () => {
    const before = (await d.select().from(scenarios)).length;
    await expect(createCustomScenario(d, "Meeting her grandmother on Sunday", { generate: async () => Promise.reject(new Error("no model")) })).rejects.toThrow("no model");
    expect((await d.select().from(scenarios)).length).toBe(before);

    const { scenarioId } = await createCustomScenario(d, "Meeting her grandmother on Sunday", { generate: async () => ({ ...VISIT_2, title: "Chez sa grand-mère" }), now: NOW });
    const [s] = await d.select().from(scenarios).where(eq(scenarios.id, scenarioId));
    expect(s).toMatchObject({ origin: "custom", title: "Chez sa grand-mère" });
  });
});
