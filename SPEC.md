# Lode — MVP Spec

*Working name. Alternatives: Strata, Talus, Dolomite.*

A language-learning app for adults that puts spaced repetition and comprehensible input in the open, with a tutor on call. Honest SRS plus a reader plus a "why?" button. No course path, no owl.

Target language for v1: French. Base language: English.

---

## 1. Principles

- **One learner model, many surfaces.** Reviews, reading, and explanations are views into the same set of atoms and the same memory state. No lesson is its own island.
- **Immersion is the source.** Beyond a starter frequency list, atoms are born from text the learner reads. The syllabus is whatever they're reading.
- **Efficiency over faffing.** Show a word the moment it's about to be forgotten, not 300 times. Cap new atoms per day; report review load honestly.
- **Rocky learning is normal.** The scheduler absorbs variable effort: light days keep the curve alive, push days are encouraged, comebacks after a week away are triaged, never punished.
- **Grammar is reactive.** No grammar course. Explanations appear when the learner asks "why?" or gets something wrong, using their own sentence as the example.
- **Reading is the reward.** Progress is legible as rising coverage on real text, not as a streak.

## 2. What the MVP is and isn't

**In:** atom model, scheduler, reader (import + generate), review screen, "why?" endpoint, home screen, stats. Responsive web app usable on a phone.

**Out for v1:** voice/pronunciation, AI conversation, audio in the reader, native iOS/Android, languages other than French, PDF/epub import, per-user FSRS parameter fitting, social features, gamification of any kind.

---

## 3. Atom model

Three kinds of atom, one memory state, sentences as evidence rather than atoms. A card is never stored; it is generated at review time from an atom and a modality.

```ts
type AtomType = "word" | "chunk" | "grammar";

interface Atom {
  id: string;
  lang: "fr";
  type: AtomType;

  // word: lemma ("vouloir"); chunk: fixed phrase ("je voudrais");
  // grammar: short slug ("conditional-polite-request")
  key: string;
  forms: string[];          // surface forms seen: "voudrais", "voudrait"
  gloss: string;            // short L1 meaning
  explanation?: string;     // the "why?" text, cached once generated
  pos?: string;             // word/chunk only
  frequencyRank?: number;   // from a frequency list, if known
  domains: Domain[];        // e.g. ["travel", "food"]; empty = general
  relatedAtoms: string[];   // word → grammar it depends on, chunk → its words

  memory: MemoryState;
  modality: Record<Modality, ModalityStat>;

  createdAt: string;
  source: "frequency" | "mined" | "conversation" | "manual";
}
```

One FSRS-style memory curve per atom. This is the only thing the scheduler reads for due-ness.

```ts
interface MemoryState {
  stability: number;   // days until recall prob ~90%
  difficulty: number;  // 1–10
  due: string;
  lastReview?: string;
  reps: number;
  lapses: number;
  status: "new" | "learning" | "review" | "suspended";
}
```

Modalities are the things you can do with an atom. They don't get their own curves; they get counters, so the scheduler can choose an exercise, not just a card.

```ts
type Modality =
  | "recognize"   // FR → EN
  | "recall"      // EN → FR, typed
  | "listen"      // audio → meaning (v2; field reserved)
  | "produce"     // use in a sentence
  | "cloze";      // fill the gap in a mined sentence

interface ModalityStat {
  attempts: number;
  correct: number;
  lastAt?: string;
}
```

Sentences are where atoms were encountered; raw material for cloze and reading.

```ts
interface Sentence {
  id: string;
  text: string;
  translation?: string;
  audioUrl?: string;       // reserved
  atomIds: string[];       // every atom present, known or not
  origin: "generated" | "imported" | "conversation";
  sourceRef?: string;      // article URL, doc id, etc.
}
```

Append-only review log. Memory state is a cache derived from this; a scheduler change means replaying the log.

```ts
interface ReviewEvent {
  atomId: string;
  modality: Modality;
  sentenceId?: string;
  grade: 1 | 2 | 3 | 4;    // again / hard / good / easy
  responseMs: number;
  at: string;
}
```

**Decisions baked in**

- `chunk` is first-class. "je voudrais", "il y a" are learned as units; decomposition is captured by `relatedAtoms`.
- Grammar atoms share the memory model and scheduler with words. Slightly wrong (grammar doesn't decay like nouns) but keeps one queue. Log replay makes it reversible.
- No "lesson" or "unit" entities. Ordering is due date and frequency rank only.

**Seed data:** a French frequency list (top ~3000 lemmas with glosses and POS) loaded as `source: "frequency"`, status `new`. A small seed list of formulaic chunks. A short list of grammar atoms for A1–A2 (articles, present tense, passé composé, negation, conditional-polite, etc.) that can be linked from "why?" explanations.

---

## 4. Scheduler

Pure function, no I/O, unit-tested against a fake log.

```ts
interface SessionRequest {
  now: string;
  timeBudgetMin: number;     // 5 / 12 / 20
  newAtomsPerDay: number;    // default 10
  newAtomsIntroducedToday: number;
  intensity: "light" | "steady" | "push";
}

interface SessionPlan {
  items: SessionItem[];      // ordered
  estimatedMin: number;
  skipped: number;           // due atoms that didn't fit
  deferred: number;          // bulk-deferred in triage mode
}

interface SessionItem {
  atomId: string;
  modality: Modality;
  sentenceId?: string;       // required for cloze
  reason: "due" | "overdue" | "new" | "weak-modality" | "relearn";
}

function planSession(atoms: Atom[], sentences: Sentence[], req: SessionRequest): SessionPlan;
function applyReview(atom: Atom, event: ReviewEvent): Atom;
```

### planSession

1. **Candidates:** everything with `due <= now` and status not suspended; new atoms up to the remaining daily allowance; anything in `learning` with a step pending.
2. **Priority, highest first:** relearn (lapsed today) → overdue, sorted by lateness relative to stability (3 days late on a 4-day card outranks 3 days late on a 60-day card) → due today → new, ordered by frequency rank, mined before frequency-list.
3. **Modality choice per atom:**
   - Recognize is the floor.
   - If `recall.attempts < 0.6 × recognize.attempts`, pick recall.
   - If a mined sentence exists and cloze hasn't been used in the last 3 reps, pick cloze.
   - Produce only once `stability > 7` days.
   - New atoms start with recognize, then recall within the same session's learning steps.
4. **Fit to budget** using per-modality time estimates (recognize ~6s, recall ~15s, cloze ~20s, produce ~40s). Overflow goes to `skipped` and is reported, not silently accumulated.
5. **Interleave:** no two consecutive items on the same atom; don't cluster produce items at the end.

### Intensity

- **light:** reviews only, no new atoms, easiest eligible modality, 5 min. Keeps the curve alive on a bad day.
- **steady:** defaults above.
- **push:** new-atom cap ×2 for the day; prefer the harder eligible modality; pull in tomorrow's due items; allow a second session. Extra new atoms have their first reviews staggered over days 1–3 so the debt is spread, not dumped.

### applyReview

Standard FSRS update on `memory` using `grade`, regardless of modality, published default parameters. Then:

- A fail in a harder modality than the atom's best-established one caps stability instead of resetting it ("recognized but couldn't produce" is a weaker modality, not a forgotten word).
- Grade 4 in recognize alone cannot push stability past a ceiling until recall has been tested at least once.
- Increment modality counters either way.
- Suspend after 8 lapses (leech).

### Comeback / triage

If due count exceeds ~3× what the budget fits: take the top-priority slice; bulk-defer the rest by rescheduling proportionally to stability (a 60-day card pushed a week loses little; a 3-day card pushed a week is just late). Report "18 today, 140 deferred," not "158 due."

### Exposure signals (from the reader)

- Untapped encounter with a known atom: small stability bump, capped, never enough to skip a review.
- Known atom tapped 3+ times in 7 days: flag fragile, pull due forward.

---

## 5. Reader

Turns text into atoms, and atoms into a reason to read more.

### Text sources

1. **Import:** paste text or a URL (server-side fetch, article body extraction). Subtitle files later.
2. **Generate:** model writes ~150–300 words constrained to the known-atom set, with a stretch slider (98% known ↔ 90%) and a genre pick (dialogue, short story, news-style, café scene, "something about where I am"). Optional `mustInclude: atomId[]`.

Generated and imported passages are treated identically downstream.

### Passage library

Generated passages are kept, not discarded. Before generating, look for an existing passage where:

- coverage recomputed against today's atoms falls in the requested band
- it contains some of `mustInclude`, if given
- genre matches loosely
- `lastReadAt` is more than 7 days ago

Serve a match if found; otherwise generate, store, and it joins the pool. Imported passages are eligible for reread too. Hard cap: one generation per session.

### Analysis

```ts
interface Passage {
  id: string;
  title?: string;
  origin: "imported" | "generated";
  sourceRef?: string;
  sentences: Sentence[];
  tokens: Token[];
  coverage: number;           // fraction of word tokens whose atom is known
  coverageAtGeneration: number;
  unknownAtoms: string[];
  reads: number;
  lastReadAt?: string;
}

interface Token {
  surface: string;            // "voudrais"
  lemma: string;              // "vouloir"
  atomId?: string;
  chunkId?: string;
  sentenceIdx: number;
  isWord: boolean;
}
```

Tokenization and lemmatization via spaCy `fr_core_news_md` in a small Python service (deterministic, cheap). Chunk detection is dictionary match against the user's chunk atoms plus the seed list. Semantic work (glosses, explanations, generation) goes to the model.

### UI

Plain rendering; unknown words underlined, not highlighted. Coverage line at top: "94% known · 6 new words." Tapping a word opens a sheet:

- gloss for this context (cached per lemma + sentence)
- the sentence with the word marked
- **Why?** → explanation using this sentence as the example
- **Mine** → create or link the atom, save the sentence
- **Already know** → create atom with mature memory state

The tapped sentence is what gets saved; cloze cards are automatic.

### 1T guidance

If Mine is tapped in a sentence with 3+ unknowns: "This sentence has 3 new words; the card will be harder." Offer a model-generated 1T sentence for the same word using known vocabulary.

### Exposure logging

```ts
interface Encounter {
  atomId: string;
  sentenceId: string;
  passageId: string;
  at: string;
  tapped: boolean;
}
```

An unknown word encountered untapped in 3 passages surfaces as "You seem to be getting *scontrino* from context. Add it?" Confirming creates the atom at `learning`.

### Scheduler integration

`planSession` prefers sentences from recent passages for cloze/produce. v2: the scheduler can request a passage with `mustInclude` = today's due atoms so a refresh happens inside reading.

---

## 6. Review screen

A renderer for `SessionItem` by modality. One item at a time, full width, minimal chrome.

| Modality | Prompt | Answer | Grading |
|---|---|---|---|
| recognize | French form (and sentence if mined) | reveal gloss | self-grade 1–4 |
| recall | English gloss (+ sentence with blank) | type French | auto-check with lenient match (accents, articles); self-grade override |
| cloze | mined sentence with gap | type the missing word | auto-check, self-grade override |
| produce | "Use *je voudrais* in a sentence" | free text | model checks, returns ok/fix + one-line note; user confirms grade |

Every item has a **Why?** link that opens the atom's explanation without leaving the session.

Session end: "8 reviewed · 3 new · 2 deferred" and a single line on effect ("Strong 872 → 876"). No confetti.

Keyboard-first on desktop, tap-first on mobile. Grade buttons: Again / Hard / Good / Easy.

---

## 7. "Why?" endpoint

`POST /api/why { atomId, sentenceId? }`

One prompt to the model with: the atom (key, type, forms, gloss), the sentence if present, the learner's known grammar atoms, target register "explain to an adult, 3–6 sentences, use the given sentence as the example, name the grammar concept, no drills." Response is cached on `Atom.explanation` (generic) and per `(atomId, sentenceId)` (contextual).

If the explanation names a grammar concept that matches or should become a grammar atom, the response includes `grammarAtomKey`; the client offers "Add *conditional for polite requests* to your reviews?" This is how grammar atoms are born.

---

## 8. Home screen

Transparent, adult, one glance.

```
French · Day 73
14 min recommended         [light] [steady] [push]

Refresh · 6 min
18 concepts ready · 2 deferred

Learn · 4 min
6 new words · 1 grammar idea

Read · 4 min
"Le marché du samedi" · 95% known
```

Below: Read (import or generate), Explore (ask anything about French; same model, no memory effect), Stats.

**Stats:** vocabulary total / strong / developing / fragile; estimated coverage on a reference corpus; passages read; a coverage-over-time line. That's it.

---

## 9. Stack

- **Web:** Next.js (App Router), TypeScript, Tailwind. PWA manifest so it installs to the home screen. Deployed on Vercel from the GitHub repo.
- **DB:** Postgres via Neon (or Supabase). Prisma or Drizzle.
- **Auth:** single-user for MVP (env-var secret or magic link). Multi-user later.
- **Model:** Anthropic API for generation, glosses, explanations, produce-grading.
- **NLP service:** small Python FastAPI app with spaCy `fr_core_news_md`, deployed separately (Fly.io or Railway); called only at passage-analysis time. Run locally in a conda env during development.
- **Scheduler:** pure TS module, no dependencies beyond an FSRS implementation (`ts-fsrs`).

Local dev (Mac, per Aaron's setup):
- Node via Homebrew (`brew install node` if not present; system tool).
- Scaffold with `npx create-next-app@latest lode` (ephemeral, no global install).
- Python service: `conda create -n lode-nlp python=3.12 && conda activate lode-nlp && pip install fastapi uvicorn spacy && python -m spacy download fr_core_news_md` (pip inside the conda env; spaCy models are PyPI-only).

## 10. Repo layout

```
lode/
  app/                 # Next.js routes
    (home)/
    read/
    review/
    stats/
    api/
      why/
      passages/
      session/
      review/
  lib/
    scheduler/         # planSession, applyReview, fsrs wrapper + tests
    atoms/             # types, seed loaders, coverage calc
    reader/            # passage analysis client, mining actions
    llm/               # prompts and thin API client
  db/
    schema.ts
    seed/              # frequency list, chunks, grammar atoms
  nlp/                 # Python FastAPI + spaCy service
    main.py
    requirements.txt
  public/
  SPEC.md              # this file
```

## 11. Milestones

1. **Skeleton:** repo, Vercel deploy, DB schema, seed frequency list, home screen showing counts.
2. **Scheduler:** `lib/scheduler` with tests; review screen for recognize/recall; log + replay.
3. **Reader (import):** paste text → analysis via NLP service → coverage → tap-to-mine → cloze cards flow into reviews.
4. **Why + generate:** "why?" endpoint with caching; passage generation with stretch slider; passage library and reuse.
5. **Polish:** triage mode, intensity, encounter signals, stats screen, PWA install.

Usable for real French reading by the end of milestone 3.

## 12. Open questions

- Chunk detection beyond dictionary match (n-gram frequency over the user's passages?).
- Whether grammar atoms need a distinct decay model after a few months of log data.
- How much self-grading to keep once auto-check is reliable.
- Greek as the second language: no spaCy model of equal quality; likely model-based lemmatization.
