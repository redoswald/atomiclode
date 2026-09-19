/**
 * Integration: a stable atom gets a situational produce card, the answer is
 * checked, and the confirmed grade lands in the log for every target used.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { atoms, producePrompts, reviewEvents } from "@/db/schema";
import { checkProduce, recordProduce } from "./produce";
import { buildSession } from "./session";

let client: PGlite;
let d: ReturnType<typeof drizzle<typeof schema>>;
const NOW = new Date("2026-09-20T12:00:00Z");
const ids: Record<string, string> = {};

beforeAll(async () => {
  client = new PGlite();
  d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: "./drizzle" });
  const stable = { status: "review" as const, stability: 12, difficulty: 5, reps: 5, scheduledDays: 12, due: "2026-09-20T08:00:00Z", lastReview: "2026-09-08T08:00:00Z" };
  const rows = await d
    .insert(atoms)
    .values([
      { type: "chunk", key: "je voudrais", gloss: "I would like", source: "scenario", ...stable },
      { type: "word", key: "café", gloss: "coffee", source: "scenario", ...stable, due: "2026-10-01T08:00:00Z" },
      { type: "word", key: "addition", gloss: "bill", source: "scenario", status: "new" },
      { type: "word", key: "pain", gloss: "bread", source: "frequency", ...stable },
    ])
    .returning({ id: atoms.id, key: atoms.key });
  for (const r of rows) ids[r.key] = r.id;
  await d.insert(producePrompts).values({
    situation: "7am, a café near the station. You want a coffee.",
    exampleAnswer: "Bonjour, je voudrais un café, s'il vous plaît.",
    targetAtomIds: [ids["je voudrais"], ids["café"], ids["addition"]],
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("produce", () => {
  it("is never planned without a grader", async () => {
    const session = await buildSession(d, "push", NOW, { produce: false });
    expect(session.cards.map((c) => c.modality)).not.toContain("produce");
  });

  it("uses a stored situation, writes one where there is none, and falls back to recall when writing fails", async () => {
    const written: string[] = [];
    const session = await buildSession(d, "push", NOW, {
      produce: true,
      writePrompt: async ({ target }) => {
        written.push(target.key);
        return { situation: "At the bakery, you want some bread.", exampleAnswer: "Une baguette, s'il vous plaît." };
      },
    });
    const voudrais = session.cards.find((c) => c.key === "je voudrais")!;
    expect(voudrais.modality).toBe("produce");
    expect(voudrais.produce?.situation).toContain("7am");
    expect(voudrais.produce?.targets.map((t) => t.key).sort()).toEqual(["addition", "café", "je voudrais"]);
    expect(written).toEqual(["pain"]);
    expect(session.cards.find((c) => c.key === "pain")?.produce?.situation).toContain("bakery");

    await d.delete(producePrompts).where(sql`${producePrompts.targetAtomIds} = ARRAY[${ids["pain"]}::uuid]`);
    const failing = await buildSession(d, "push", NOW, { produce: true, writePrompt: async () => Promise.reject(new Error("no model")) });
    expect(failing.cards.find((c) => c.key === "pain")?.modality).toBe("recall");
  });

  it("checks an answer and logs the primary grade plus a Good for other known targets that were used", async () => {
    const [prompt] = await d.select().from(producePrompts).where(sql`${ids["café"]}::uuid = any(${producePrompts.targetAtomIds})`);
    const check = await checkProduce(d, prompt.id, "Bonjour, je voudrais un café… euh, l'addition aussi", async ({ targets, answer }) => {
      expect(targets.map((t) => t.key).sort()).toEqual(["addition", "café", "je voudrais"]);
      return { ok: true, used: ["je voudrais", "café", "addition", "not-a-target"], natural: answer, note: "" };
    });
    expect(check.usedAtomIds.sort()).toEqual([ids["je voudrais"], ids["café"], ids["addition"]].sort());

    await recordProduce(d, { atomId: ids["je voudrais"], promptId: prompt.id, grade: 3, responseMs: 20_000, usedAtomIds: check.usedAtomIds }, NOW);
    const events = await d.select().from(reviewEvents);
    expect(events.every((e) => e.modality === "produce")).toBe(true);
    // "addition" is still new: a produce answer must not introduce it behind the daily cap.
    expect(events.map((e) => e.atomId).sort()).toEqual([ids["je voudrais"], ids["café"]].sort());
    const [row] = await d.select().from(atoms).where(eq(atoms.id, ids["je voudrais"]));
    expect(row.modality.produce).toMatchObject({ attempts: 1, correct: 1 });

    await expect(recordProduce(d, { atomId: ids["pain"], promptId: prompt.id, grade: 3, responseMs: 1, usedAtomIds: [] }, NOW)).rejects.toThrow();
  });
});
