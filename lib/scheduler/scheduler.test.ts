import { describe, expect, it } from "vitest";
import { emptyModalityStats, newMemoryState, type Atom, type Grade, type Modality, type ReviewEvent, type Sentence } from "@/lib/atoms/types";
import { applyReview, LEECH_LAPSES, RECOGNIZE_ONLY_CEILING_DAYS } from "./applyReview";
import { chooseModality, interleave, planSession, type SessionRequest } from "./planSession";
import { replay } from "./replay";

const T0 = "2026-09-01T09:00:00.000Z";
const DAY = 86_400_000;
const at = (days: number, base = T0) => new Date(new Date(base).getTime() + days * DAY).toISOString();

let counter = 0;
function atom(over: Partial<Atom> = {}): Atom {
  const id = over.id ?? `a${++counter}`;
  return {
    id,
    lang: "fr",
    type: "word",
    key: `mot${id}`,
    forms: [],
    gloss: "word",
    domains: [],
    relatedAtoms: [],
    memory: newMemoryState(T0),
    modality: emptyModalityStats(),
    createdAt: T0,
    source: "frequency",
    frequencyRank: counter,
    ...over,
  };
}

function ev(a: Atom, grade: Grade, when: string, modality: Modality = "recognize"): ReviewEvent {
  return { atomId: a.id, modality, grade, responseMs: 3000, at: when };
}

/** Review the atom repeatedly with the given grades, one day apart unless the step is shorter. */
function drill(a: Atom, grades: Grade[], modality: Modality = "recognize", start = T0): Atom {
  let cur = a;
  let when = new Date(start).getTime();
  for (const g of grades) {
    // review when due (or now if due already passed)
    when = Math.max(when + 60_000, new Date(cur.memory.due).getTime());
    cur = applyReview(cur, ev(cur, g, new Date(when).toISOString(), modality));
  }
  return cur;
}

describe("applyReview", () => {
  it("moves a new atom into learning, then review, with growing stability", () => {
    const a = atom();
    const once = applyReview(a, ev(a, 3, T0));
    expect(once.memory.status).toBe("learning");
    expect(once.memory.reps).toBe(1);
    expect(once.modality.recognize).toMatchObject({ attempts: 1, correct: 1, lastAt: T0 });

    const graduated = drill(a, [3, 3, 3]);
    expect(graduated.memory.status).toBe("review");
    expect(graduated.memory.stability).toBeGreaterThan(0);
    expect(new Date(graduated.memory.due).getTime()).toBeGreaterThan(new Date(graduated.memory.lastReview!).getTime());
  });

  it("counts a fail in the established modality as a lapse", () => {
    const strong = drill(atom(), [3, 3, 3, 3, 3]);
    expect(strong.memory.status).toBe("review");
    const failed = applyReview(strong, ev(strong, 1, at(1, strong.memory.due)));
    expect(failed.memory.lapses).toBe(1);
    expect(failed.memory.status).toBe("learning");
    expect(failed.memory.stability).toBeLessThan(strong.memory.stability);
    expect(failed.modality.recognize.correct).toBe(5);
    expect(failed.modality.recognize.attempts).toBe(6);
  });

  it("caps instead of resetting when the fail is in a harder, untested modality", () => {
    const strong = drill(atom(), [3, 3, 3, 3, 3]);
    const when = at(0.5, strong.memory.due);
    const soft = applyReview(strong, ev(strong, 1, when, "recall"));
    expect(soft.memory.lapses).toBe(0);
    expect(soft.memory.status).toBe("review");
    expect(soft.memory.stability).toBeLessThanOrEqual(strong.memory.stability);
    expect(soft.modality.recall).toMatchObject({ attempts: 1, correct: 0 });

    // But once recall is established, a recall fail is a real lapse.
    const withRecall = applyReview(strong, ev(strong, 3, when, "recall"));
    const hardFail = applyReview(withRecall, ev(withRecall, 1, at(1, withRecall.memory.due), "recall"));
    expect(hardFail.memory.lapses).toBe(1);
  });

  it("holds recognize-only Easy answers under the ceiling until recall is tested", () => {
    let a = atom();
    for (let i = 0; i < 6; i++) {
      a = applyReview(a, ev(a, 4, at(0.01, a.memory.due)));
    }
    expect(a.memory.stability).toBeLessThanOrEqual(RECOGNIZE_ONLY_CEILING_DAYS);
    expect(new Date(a.memory.due).getTime() - new Date(a.memory.lastReview!).getTime()).toBeLessThanOrEqual(
      RECOGNIZE_ONLY_CEILING_DAYS * DAY + 1000,
    );

    let b = atom();
    b = applyReview(b, ev(b, 3, T0, "recall"));
    for (let i = 0; i < 6; i++) {
      b = applyReview(b, ev(b, 4, at(0.01, b.memory.due)));
    }
    expect(b.memory.stability).toBeGreaterThan(RECOGNIZE_ONLY_CEILING_DAYS);
  });

  it("suspends a leech after enough lapses", () => {
    let a = drill(atom(), [3, 3, 3]);
    for (let i = 0; i < LEECH_LAPSES; i++) {
      a = applyReview(a, ev(a, 1, at(0.01, a.memory.due))); // lapse
      a = drill(a, [3, 3]); // relearn
      if (a.memory.status === "suspended") break;
    }
    expect(a.memory.lapses).toBe(LEECH_LAPSES);
    expect(a.memory.status).toBe("suspended");
    // Suspension sticks through further reviews.
    const again = applyReview(a, ev(a, 3, at(1, a.memory.due)));
    expect(again.memory.status).toBe("suspended");
  });

  it("rejects an event for a different atom", () => {
    const a = atom();
    const b = atom();
    expect(() => applyReview(a, ev(b, 3, T0))).toThrow();
  });
});

describe("replay", () => {
  it("rebuilds the same state as incremental application", () => {
    const a = atom();
    const b = atom();
    const events: ReviewEvent[] = [];
    let ia = a;
    let ib = b;
    const grades: Grade[] = [3, 3, 1, 3, 3, 4, 3];
    grades.forEach((g, i) => {
      const ea = ev(ia, g, at(i), i % 2 ? "recall" : "recognize");
      const eb = ev(ib, (5 - g) as Grade, at(i + 0.5));
      events.push(eb, ea); // deliberately out of order
      ia = applyReview(ia, ea);
      ib = applyReview(ib, eb);
    });
    const [ra, rb] = replay([a, b], events);
    expect(ra.memory).toEqual(ia.memory);
    expect(ra.modality).toEqual(ia.modality);
    expect(rb.memory).toEqual(ib.memory);
  });

  it("resets atoms with no events to new", () => {
    const a = drill(atom(), [3, 3, 3]);
    const [r] = replay([a], []);
    expect(r.memory.status).toBe("new");
    expect(r.memory.reps).toBe(0);
    expect(r.memory.due).toBe(a.createdAt);
  });
});

const req = (over: Partial<SessionRequest> = {}): SessionRequest => ({
  now: at(10),
  timeBudgetMin: 12,
  newAtomsPerDay: 10,
  newAtomsIntroducedToday: 0,
  intensity: "steady",
  ...over,
});

function reviewAtom(over: Partial<Atom> & { due: string; stability?: number; lastReview?: string; lapses?: number }): Atom {
  const { due, stability = 5, lastReview = at(9), lapses = 0, ...rest } = over;
  return atom({
    ...rest,
    memory: { ...newMemoryState(T0), status: "review", due, stability, lastReview, reps: 4, lapses, scheduledDays: stability },
    modality: {
      ...emptyModalityStats(),
      recognize: { attempts: 4, correct: 4, lastAt: lastReview },
      recall: { attempts: 3, correct: 3, lastAt: lastReview },
      produce: { attempts: 3, correct: 3, lastAt: lastReview },
    },
  });
}

describe("planSession", () => {
  it("orders relearn → overdue by relative lateness → due today → new by rank", () => {
    const relearn = atom({
      id: "relearn",
      memory: { ...newMemoryState(T0), status: "learning", due: at(9.9), lastReview: at(9.8), reps: 5, lapses: 1, stability: 1 },
    });
    const lateShort = reviewAtom({ id: "lateShort", due: at(7), stability: 4 }); // 3 days late on a 4-day card
    const lateLong = reviewAtom({ id: "lateLong", due: at(7), stability: 60 }); // 3 days late on a 60-day card
    const today = reviewAtom({ id: "today", due: at(9.9) });
    const fresh1 = atom({ id: "fresh1", frequencyRank: 50 });
    const fresh2 = atom({ id: "fresh2", frequencyRank: 10 });
    const mined = atom({ id: "mined", source: "mined", frequencyRank: undefined });
    const future = reviewAtom({ id: "future", due: at(12) });
    const noGloss = atom({ id: "noGloss", gloss: "", frequencyRank: 1 });

    const plan = planSession([future, fresh1, today, lateLong, noGloss, relearn, mined, fresh2, lateShort], [], req());
    expect(plan.items.map((i) => i.atomId)).toEqual(["relearn", "lateShort", "lateLong", "today", "mined", "fresh2", "fresh1"]);
    expect(plan.items.map((i) => i.reason)).toEqual(["relearn", "overdue", "overdue", "due", "new", "new", "new"]);
    expect(plan.skipped).toBe(0);
    expect(plan.deferred).toBe(0);
  });

  it("respects the daily new-atom allowance and intensity", () => {
    const fresh = Array.from({ length: 30 }, (_, i) => atom({ frequencyRank: i + 1 }));
    expect(planSession(fresh, [], req()).items).toHaveLength(10);
    expect(planSession(fresh, [], req({ newAtomsIntroducedToday: 7 })).items).toHaveLength(3);
    expect(planSession(fresh, [], req({ intensity: "light" })).items).toHaveLength(0);
    expect(planSession(fresh, [], req({ intensity: "push" })).items).toHaveLength(20);
  });

  it("fits the budget and reports what did not fit", () => {
    const due = Array.from({ length: 25 }, () => reviewAtom({ due: at(9.9) }));
    const plan = planSession(due, [], req({ timeBudgetMin: 1 })); // 60s = 10 recognize items
    expect(plan.items).toHaveLength(10);
    expect(plan.skipped).toBe(15);
    expect(plan.deferred).toBe(0);
    expect(plan.estimatedMin).toBeLessThanOrEqual(1);
  });

  it("pulls in tomorrow's reviews on push, but not on steady", () => {
    const tomorrow = reviewAtom({ due: at(10.5) });
    expect(planSession([tomorrow], [], req()).items).toHaveLength(0);
    expect(planSession([tomorrow], [], req({ intensity: "push" })).items).toHaveLength(1);
  });

  it("includes learning steps that come due during the session", () => {
    const step = atom({ memory: { ...newMemoryState(T0), status: "learning", due: at(10 + 5 / 1440), reps: 1, lastReview: at(10) } });
    expect(planSession([step], [], req({ timeBudgetMin: 12 })).items).toHaveLength(1);
    expect(planSession([step], [], req({ timeBudgetMin: 2 })).items).toHaveLength(0);
  });

  it("triages a comeback: keeps the top slice, defers the rest in proportion to stability", () => {
    const pile = [
      ...Array.from({ length: 60 }, () => reviewAtom({ due: at(2), stability: 3 })),
      ...Array.from({ length: 60 }, () => reviewAtom({ due: at(2), stability: 60 })),
    ];
    const plan = planSession(pile, [], req({ timeBudgetMin: 2 }));
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.deferred).toBe(120 - plan.items.length);
    expect(plan.skipped).toBe(0);
    const days = (d: string) => Math.round((new Date(d).getTime() - new Date(req().now).getTime()) / DAY);
    const byAtom = new Map(pile.map((a) => [a.id, a]));
    for (const d of plan.deferrals) {
      const stability = byAtom.get(d.atomId)!.memory.stability;
      expect(days(d.due)).toBe(stability === 3 ? 1 : 14);
    }
  });

  it("chooses modalities per the cascade", () => {
    const base: Atom = { ...reviewAtom({ due: at(9.9), stability: 10 }) };
    base.modality = { ...base.modality, produce: { attempts: 0, correct: 0 } };
    const untestedRecall: Atom = { ...base, modality: { ...emptyModalityStats(), recognize: { attempts: 5, correct: 5 } } };
    expect(chooseModality(untestedRecall, false, "steady")).toBe("recall");
    expect(chooseModality(untestedRecall, false, "light")).toBe("recognize");
    expect(chooseModality(untestedRecall, true, "steady")).toBe("recall");
    expect(chooseModality(base, true, "steady")).toBe("cloze");
    expect(chooseModality(base, false, "steady")).toBe("produce");
    expect(chooseModality({ ...base, memory: { ...base.memory, stability: 3 } }, false, "steady")).toBe("recognize");
    expect(chooseModality(base, false, "push")).toBe("produce");
    expect(chooseModality(atom(), true, "push")).toBe("recognize");
  });

  it("attaches a mined sentence to cloze items", () => {
    const a = reviewAtom({ id: "cloze-me", due: at(9.9) });
    const sentences: Sentence[] = [
      { id: "s-gen", text: "…", atomIds: [a.id], origin: "generated" },
      { id: "s-mined", text: "…", atomIds: [a.id], origin: "imported" },
    ];
    const [item] = planSession([a], sentences, req()).items;
    expect(item.modality).toBe("cloze");
    expect(item.sentenceId).toBe("s-mined");
  });

  it("spreads produce items and never repeats an atom back to back", () => {
    const items = [
      { atomId: "a", modality: "recognize" as const, reason: "due" as const },
      { atomId: "a", modality: "recall" as const, reason: "due" as const },
      { atomId: "b", modality: "recognize" as const, reason: "due" as const },
      { atomId: "c", modality: "produce" as const, reason: "due" as const },
      { atomId: "d", modality: "produce" as const, reason: "due" as const },
      { atomId: "e", modality: "recognize" as const, reason: "due" as const },
    ];
    const out = interleave(items);
    expect(out).toHaveLength(items.length);
    expect(new Set(out.map((i) => `${i.atomId}:${i.modality}`)).size).toBe(items.length);
    for (let i = 1; i < out.length; i++) expect(out[i].atomId).not.toBe(out[i - 1].atomId);
    const produceIdx = out.map((i, k) => (i.modality === "produce" ? k : -1)).filter((k) => k >= 0);
    expect(produceIdx[produceIdx.length - 1]).toBeLessThan(out.length - 1);
  });
});
