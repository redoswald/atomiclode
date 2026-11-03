import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { speechClips } from "@/db/schema";
import wordsEl from "@/db/seed/words-el.json";
import course from "@/db/seed/course-el.json";
import { scriptUnits } from "@/lib/greek/script";
import { clipKey, getOrCreateClip } from "./clips";
import { dialogueLines, LETTER_SAY, MAX_SPEECH_CHARS, speechPath, spokenText } from "./say";
import type { SynthesizeInput } from "./tts";

describe("what a card says", () => {
  it("says nouns with their article", () => {
    expect(spokenText({ lang: "el", type: "word", key: "έξοδος", pos: "NOUN", gender: "f" })).toBe("η έξοδος");
    expect(spokenText({ lang: "fr", type: "word", key: "boulangerie", pos: "NOUN", gender: "f" })).toBe("la boulangerie");
    expect(spokenText({ lang: "fr", type: "word", key: "école", pos: "NOUN", gender: "f" })).toBe("l'école");
  });

  it("says signs as a plain word, phrases as written, grammar not at all", () => {
    expect(spokenText({ lang: "el", type: "word", key: "έξοδος", pos: "NOUN", gender: "f", domains: ["signs"] })).toBe("έξοδος");
    expect(spokenText({ lang: "el", type: "chunk", key: "ευχαριστώ πολύ" })).toBe("ευχαριστώ πολύ");
    expect(spokenText({ lang: "fr", type: "grammar", key: "passe-compose" })).toBeUndefined();
  });

  it("has example words for every letter in the seed", () => {
    const letters = (wordsEl as Array<{ lemma: string; pos: string }>).filter((w) => w.pos === "LETTER").map((w) => w.lemma);
    expect(letters.length).toBeGreaterThan(0);
    for (const l of letters) expect(LETTER_SAY[l], l).toBeTruthy();
    expect(spokenText({ lang: "el", type: "word", key: "letter:ρ", pos: "LETTER" })).toBe("ρολόι, ρύζι");
  });

  it("plays a letter's sound in words that start with it, never its name, never a course item", () => {
    const items = new Set(course.units.flatMap((u) => u.lessons.flatMap((l) => l.items.map((i) => i.key))));
    for (const [key, say] of Object.entries(LETTER_SAY)) {
      const unit = key.replace("letter:", "");
      for (const word of say.split(", ")) {
        // γγ never starts a word; it sits inside one.
        if (unit === "γγ") expect(scriptUnits(word), word).toContain(unit);
        else expect(scriptUnits(word)[0], `${key}: ${word}`).toBe(unit);
        expect(items.has(word), `${word} is a course item`).toBe(false);
      }
    }
  });
});

describe("dialogue", () => {
  it("alternates the two voices on dashed turns and drops the dash", () => {
    const lines = dialogueLines("— Καλημέρα! Τι θα πάρετε;\n— Έναν καφέ, παρακαλώ.\n\nΟ σερβιτόρος φεύγει.\n— Ορίστε.");
    expect(lines).toEqual([
      { text: "Καλημέρα! Τι θα πάρετε;", voice: 0 },
      { text: "Έναν καφέ, παρακαλώ.", voice: 1 },
      { text: "Ο σερβιτόρος φεύγει.", voice: 0 },
      { text: "Ορίστε.", voice: 0 },
    ]);
  });

  it("builds clip paths with normalized text", () => {
    expect(speechPath("el", "  καφές \n ")).toBe("/api/speech?lang=el&text=%CE%BA%CE%B1%CF%86%CE%AD%CF%82");
    expect(speechPath("fr", "pain", 1, "slow")).toBe("/api/speech?lang=fr&text=pain&voice=1&rate=slow");
  });
});

describe("clips", () => {
  let client: PGlite;
  let d: ReturnType<typeof drizzle<typeof schema>>;
  const calls: SynthesizeInput[] = [];
  const stored: string[] = [];
  const deps = {
    synthesize: async (input: SynthesizeInput) => {
      calls.push(input);
      return new Uint8Array([1, 2, 3]);
    },
    store: async (pathname: string) => {
      stored.push(pathname);
      return `https://blob.example/${pathname}`;
    },
  };

  beforeAll(async () => {
    client = new PGlite();
    d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: "./drizzle" });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("voices a clip once and serves it from the cache after", async () => {
    const first = await getOrCreateClip(d, { lang: "el", text: " καφές " }, deps);
    const again = await getOrCreateClip(d, { lang: "el", text: "καφές" }, deps);
    expect(first.created).toBe(true);
    expect(again).toEqual({ url: first.url, created: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ text: "καφές", languageCode: "el-GR", voice: "el-GR-Chirp3-HD-Leda", rate: "normal" });
    const [row] = await d.select().from(speechClips);
    expect(row.key).toBe(clipKey("el", "el-GR-Chirp3-HD-Leda", "normal", "καφές"));
    expect(stored[0]).toBe(`speech/${row.key}.mp3`);
  });

  it("keeps slow and second-voice clips apart", async () => {
    await getOrCreateClip(d, { lang: "el", text: "καφές", rate: "slow" }, deps);
    await getOrCreateClip(d, { lang: "el", text: "καφές", voice: 1 }, deps);
    expect(calls.slice(1).map((c) => [c.voice, c.rate])).toEqual([
      ["el-GR-Chirp3-HD-Leda", "slow"],
      ["el-GR-Chirp3-HD-Charon", "normal"],
    ]);
  });

  it("refuses empty and overlong text", async () => {
    await expect(getOrCreateClip(d, { lang: "fr", text: "   " }, deps)).rejects.toThrow("Nothing to say");
    await expect(getOrCreateClip(d, { lang: "fr", text: "a".repeat(MAX_SPEECH_CHARS + 1) }, deps)).rejects.toThrow("Too long");
  });
});
