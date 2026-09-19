/**
 * Integration: pin a long family history as the goal, watch its coverage, prepare
 * it with fake models, climb a rung, see its words lead the queue once the learner
 * is reading, and reach it.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, goals, passages } from "@/db/schema";
import chunks from "@/db/seed/chunks-fr.json";
import freq from "@/db/seed/frequency-fr.json";
import grammar from "@/db/seed/grammar-fr.json";
import { seedAtoms } from "@/db/seed/run";
import { phaseFor } from "@/lib/atoms/phase";
import type { ChunkEntry, FrequencyEntry, GrammarEntry } from "@/lib/atoms/seed";
import { adaptPassage, findReusable } from "@/lib/reader/library";
import { createPassage, listPassages, openPassage } from "@/lib/reader/passages";
import { newAtomOrder } from "@/lib/review/newOrder";
import { activeGoal, goalCoverageSeries, goalLemmasForScenarios, goalNewOrder, goalView, pinGoal, prepareGoal, rungGate } from "./goals";
import { sectionize } from "./sections";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-20T12:00:00Z");

const PARA = (n: number) =>
  `Mon grand-père Marcel naquit en 1921 dans un petit village près de Lyon. Sa famille possédait une ferme et quelques vignes. ` +
  `Pendant la guerre, la famille cacha des voisins dans la grange ; mon grand-père parlait rarement de cette époque. ` +
  `Après la guerre, il rencontra ma grand-mère au marché du village, et ils eurent quatre enfants. Chapitre ${n}.`;
const LETTER = Array.from({ length: 8 }, (_, i) => PARA(i + 1)).join("\n\n") + "\n\nIl disait toujours : saperlipopette !";

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  await seedAtoms(d, { freq: freq as FrequencyEntry[], chunks: chunks as ChunkEntry[], grammar: grammar as GrammarEntry[] });
  await d.update(atoms).set({ status: "review", stability: 20, reps: 3 }).where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} <= 40`);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("sectionize", () => {
  it("cuts at paragraphs, then sentences, and loses nothing", () => {
    const sections = sectionize(LETTER, 120);
    expect(sections.length).toBeGreaterThan(2);
    expect(sections.every((s) => s.split(/\s+/).length <= 120)).toBe(true);
    expect(sections.join("\n\n")).toBe(LETTER);
    const wall = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i} de ce très long paragraphe.`).join(" ");
    const cut = sectionize(wall, 50);
    expect(cut.length).toBeGreaterThan(3);
    expect(cut.join(" ")).toBe(wall);
    expect(sectionize("Court.")).toEqual(["Court."]);
  });
});

describe("goal texts", () => {
  let goalId: string;
  let originalId: string;

  it("pins an imported text: sections, one active goal, names out of coverage", async () => {
    ({ id: originalId } = await createPassage(d, { title: "La famille Martin", text: LETTER, origin: "imported" }));
    const { id: other } = await createPassage(d, { title: "Un autre texte", text: "Le chat est sur la table. Il est petit et il est content.", origin: "imported" });
    const first = await pinGoal(d, other, NOW);
    goalId = await pinGoal(d, originalId, NOW);
    expect(await pinGoal(d, (await d.select().from(goals).where(eq(goals.id, goalId)))[0].passageIds[0], NOW)).toBe(goalId); // idempotent
    expect((await activeGoal(d))?.id).toBe(goalId);
    expect((await d.select().from(goals).where(eq(goals.id, first)))[0].status).toBe("waiting");

    const view = (await goalView(d, goalId, NOW))!;
    expect(view.sections.length).toBeGreaterThan(1);
    expect(view.coverage).toBeGreaterThan(0.2);
    expect(view.coverage).toBeLessThan(0.7);
    expect(view.sections.every((s) => s.rungs.map((r) => r.level).join() === "gist,comfortable,balanced,challenging,original")).toBe(true);
    expect(view.sections[0].recommended).toBeUndefined();
    expect(view.queued).toBeLessThan(view.unknownLemmas); // one-off rarities stay out of the queue
    const series = await goalCoverageSeries(d, goalId);
    expect(series).toHaveLength(1);
    expect(series[0].date).toBe("2026-09-20");
    expect(series[0].coverage).toBeCloseTo(view.coverage, 5);

    // Sections live on the goal page: not in the library list, not served as "something new".
    expect((await listPassages(d)).map((p) => p.title)).toEqual(["La famille Martin"]);
    expect(await findReusable(d, { targetCoverage: view.sections[0].coverage, genre: "short story", mustInclude: [] }, NOW)).toMatchObject({ id: originalId });
    const [section] = await d.select().from(passages).where(eq(passages.id, view.sections[0].passage.id));
    expect(section.tokens.find((t) => t.surface === "Marcel")?.isWord).toBe(false);
  });

  it("prepares the text: glosses its words, finds its grammar, suggests scenes", async () => {
    const asked: string[] = [];
    const result = await prepareGoal(
      d,
      goalId,
      {
        gloss: async (items) => {
          asked.push(...items.map((i) => i.lemma));
          return new Map(items.map((i) => [i.lemma, `gloss of ${i.lemma}`]));
        },
        survey: async ({ grammar: known, text }) => {
          expect(text).toContain("naquit");
          expect(known.some((g) => g.key === "imparfait")).toBe(true);
          return {
            grammar: [
              { key: "imparfait", gloss: "imparfait", explanation: "…", receptiveOnly: false },
              { key: "Passé simple", gloss: "the literary past: il naquit", explanation: "A written-only past tense…", receptiveOnly: true },
            ],
            scenes: ["Your father-in-law is showing you old family photographs."],
          };
        },
      },
      NOW,
    );
    expect(result).toMatchObject({ grammar: 2, scenes: 1 });
    expect(asked).toContain("village");
    expect(result.glossed).toBe(asked.length);

    const [goal] = await d.select().from(goals).where(eq(goals.id, goalId));
    const found = await d.select().from(atoms).where(inArray(atoms.id, goal.grammarAtomIds));
    expect(found.find((g) => g.key === "passe-simple")).toMatchObject({ receptiveOnly: true, source: "goal", type: "grammar" });
    expect(found.find((g) => g.key === "imparfait")?.source).toBe("frequency");

    // A second run glosses what is left and doesn't survey again.
    const again = await prepareGoal(d, goalId, { gloss: async () => new Map(), survey: async () => Promise.reject(new Error("surveyed twice")) }, NOW);
    expect(again.grammar).toBe(2);
  });

  it("leads the new-atom order only once the learner is reading; before that it steers scenarios", async () => {
    const order = await goalNewOrder(d);
    const [goal] = await d.select().from(goals).where(eq(goals.id, goalId));
    expect(order.slice(0, 2)).toEqual(goal.grammarAtomIds);
    const keys = (await d.select({ id: atoms.id, key: atoms.key }).from(atoms).where(inArray(atoms.id, order))).map((r) => r.key);
    expect(keys).toContain("village"); // eight times in the text
    expect(keys).not.toContain("saperlipopette"); // once, and rare: glossed in place, never a card

    expect((await newAtomOrder(d, false)).phase).toBe("foundation");
    expect((await newAtomOrder(d, false)).newOrder).toEqual([]);
    expect(await goalLemmasForScenarios(d)).toContain("village");
    expect(phaseFor(0.79)).toBe("foundation");
    expect(phaseFor(0.8)).toBe("reading");
  });

  it("gates the ladder honestly, writes a rung, and flags it stale once outgrown", async () => {
    expect(rungGate("gist", 40, "foundation")).toMatch(/300/);
    expect(rungGate("gist", 300, "foundation")).toBeUndefined();
    expect(rungGate("balanced", 600, "foundation")).toMatch(/reading phase/);
    expect(rungGate("balanced", 900, "reading")).toBeUndefined();

    const view = (await goalView(d, goalId, NOW))!;
    const sectionId = view.sections[0].passage.id;
    const easy = "Le père de mon père est né en 1921. Il est de Lyon. Il a une femme et des enfants. Il ne parle pas de la guerre. C'est un homme bon.";
    const rung = await adaptPassage(d, sectionId, "gist", async () => ({ title: "La famille Martin", text: easy }));
    expect(rung.reused).toBe(false);

    const after = (await goalView(d, goalId, NOW))!;
    const gist = after.sections[0].rungs[0];
    expect(gist).toMatchObject({ level: "gist", passageId: rung.id, stale: false });
    expect(after.sections[0].recommended?.level === "gist" || (gist.coverage ?? 0) < 0.9).toBe(true);

    // The learner learns a lot more: the old rung is stale, and a rewrite makes a new passage.
    await d.update(atoms).set({ status: "review", stability: 20, reps: 3 }).where(sql`${atoms.type} = 'word' and ${atoms.frequencyRank} <= 60`);
    expect((await goalView(d, goalId, NOW))!.sections[0].rungs[0].stale).toBe(true);
    const rewritten = await adaptPassage(d, sectionId, "gist", async () => ({ title: "La famille Martin", text: easy }), { refresh: true });
    expect(rewritten.id).not.toBe(rung.id);
    expect((await goalView(d, goalId, NOW))!.sections[0].rungs[0]).toMatchObject({ passageId: rewritten.id, stale: false });
  });

  it("is reached when the original is 95% known and every section has been read", async () => {
    const view = (await goalView(d, goalId, NOW))!;
    const sectionIds = view.sections.map((s) => s.passage.id);
    const rows = await d.select().from(passages).where(inArray(passages.id, sectionIds));
    const lemmas = Array.from(new Set(rows.flatMap((p) => p.tokens.filter((t) => t.isWord).map((t) => t.lemma))));
    for (const lemma of lemmas) {
      await d.insert(atoms).values({ type: "word", key: lemma, gloss: "x", source: "goal", status: "review", stability: 30 }).onConflictDoUpdate({ target: [atoms.lang, atoms.type, atoms.key], set: { status: "review", stability: 30 } });
    }
    expect((await goalView(d, goalId, NOW))!.reached).toBe(false); // known, but not read
    for (const id of sectionIds) await openPassage(d, id, NOW);
    const done = (await goalView(d, goalId, NOW))!;
    expect(done.coverage).toBeGreaterThanOrEqual(0.95);
    expect(done.reached).toBe(true);
    expect(await activeGoal(d)).toBeUndefined();
  });
});
