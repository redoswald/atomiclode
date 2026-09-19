# Dolomite — Spec

*Named for where it was written: on a phone, on a trail in the Italian Dolomites, to learn French. (Formerly "Lode"; the repo is still `atomiclode`.)*

A language-learning app for adults that puts spaced repetition and comprehensible input in the open, with a tutor on call. Honest SRS, situations to stand in, a reader, and a "why?" button. No unlock tree, no owl.

**v2 of this spec.** Milestones 1–5 (§13) built the MVP. v2 adds *scenarios* (§10), *goal texts* (§11) and situational *produce* cards (§6), and changes what orders new atoms: a situation or a goal first, frequency rank as the fallback. Sections 1–9 keep their numbers because code comments cite them.

Target language for v1: French. Base language: English.

---

## 1. Principles

- **One learner model, many surfaces.** Reviews, reading, and explanations are views into the same set of atoms and the same memory state. No lesson is its own island.
- **Something you want is the syllabus.** New atoms arrive because a situation needs them (ordering a coffee at 7am) or a text you want to read contains them (your father-in-law's family history). The frequency list is the backbone that keeps those choices sane, and the fallback when nothing else is asking; it is never the experience.
- **Foundation, then reading.** Below roughly a thousand words, real text can't be simplified into something you can read without gutting it, so the early vocabulary comes from scenarios. Once it can, reading takes over. Same atoms, same scheduler, same queue throughout; only the source of new atoms shifts.
- **Words arrive in company.** No bare *de* or *que* as a first card. Function words ride in on chunks and sentences from a situation.
- **Efficiency over faffing.** Show a word the moment it's about to be forgotten, not 300 times. Cap new atoms per day; report review load honestly.
- **Rocky learning is normal.** The scheduler absorbs variable effort: light days keep the curve alive, push days are encouraged, comebacks after a week away are triaged, never punished.
- **Structure without a tree.** Scenarios give a beginner the scaffolding Duolingo gets right ("hi, my name is" *is* a good foundation) without what it gets wrong: nothing is locked, nothing is "completed", and no sentence is without a situation.
- **Grammar is reactive.** No grammar course. Explanations appear when the learner asks "why?" or gets something wrong, using their own sentence as the example.
- **Reading is the reward.** Progress is legible as rising coverage on real text, ideally one specific text you care about, not as a streak.

## 2. What the MVP is and isn't

**In (built, milestones 1–5):** atom model, scheduler, reader (import + generate + adapt), review screen (recognize / recall / cloze), "why?" endpoint, home screen, stats. Responsive web app, installable as a PWA.

**In (v2, milestones 6–8):** situational produce cards, scenarios, goal texts.

**Out for now:** voice/pronunciation, open-ended AI conversation, audio in the reader, native iOS/Android (the PWA is the phone app until offline, audio, or a share sheet justify more), languages other than French, PDF/epub import, per-user FSRS parameter fitting, social features, gamification of any kind.

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
  receptiveOnly?: boolean;  // read it, never say it (passé simple); recognize and cloze only (§11)

  memory: MemoryState;
  modality: Record<Modality, ModalityStat>;

  createdAt: string;
  source: "frequency" | "mined" | "scenario" | "goal" | "conversation" | "manual";
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
  origin: "generated" | "imported" | "scenario" | "conversation";
  sourceRef?: string;      // article URL, doc id, scenario visit id, etc.
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
- No "lesson" or "unit" entities in the scheduler. Review order is due date only. The order in which *new* atoms are introduced comes from scenarios and goal texts (§4, §10, §11), with frequency rank as the fallback. A scenario is a source of atoms and sentences, not a container: it has no completion state the scheduler reads, and nothing is locked behind it.
- `source` records why an atom was introduced and never changes. A frequency-list atom introduced through a scenario keeps its `frequencyRank` and gets `source: "scenario"`.
- Sentences with origin `scenario` are cloze-eligible, like imported ones: the line from the café is the context the word was learned in. Sentences from free generation still are not.

**Seed data:** a small set of seed scenarios (§10). A French frequency list (top ~3000 lemmas with glosses and POS) loaded as `source: "frequency"`, status `new`. A small seed list of formulaic chunks. A short list of grammar atoms for A1–A2 (articles, present tense, passé composé, negation, conditional-polite, etc.) that can be linked from "why?" explanations.

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
2. **Priority, highest first:** relearn (lapsed today) → overdue, sorted by lateness relative to stability (3 days late on a 4-day card outranks 3 days late on a 60-day card) → due today → new. New atoms are ordered by where they come from:
   1. mined by hand in the reader (the learner asked for it);
   2. the bundle of the current scenario visit, in bundle order (§10);
   3. unknown atoms of the active goal text, by occurrences in the goal, then frequency rank (§11);
   4. the frequency list, by rank.

   In the foundation phase (below) the goal doesn't feed the queue at all, it only steers scenario bundles; in the reading phase 3 outranks 2. `planSession` stays pure: the caller passes a `newOrder: atomId[]` it computed, and the scheduler only applies the daily cap and the budget. Two consequences: a scenario or goal atom that isn't in `newOrder` belongs to a visit nobody has opened and waits there; and while the foundation phase has a visit under way or on offer, the frequency fallback (4) is switched off, so an empty Learn row means "open the next scene", never "here is *de*".
3. **Modality choice per atom:**
   - Recognize is the floor.
   - If `recall.attempts < 0.6 × recognize.attempts`, pick recall.
   - If a mined sentence exists and cloze hasn't been used in the last 3 reps, pick cloze.
   - Produce only once `stability > 7` days, and only when a situational prompt exists or can be generated for the atom (§6). Until the produce card is built the scheduler must not emit `produce` at all; a produce item rendered as recognize corrupts the modality counters.
   - New atoms start with recognize, then recall within the same session's learning steps.
4. **Fit to budget** using per-modality time estimates (recognize ~6s, recall ~15s, cloze ~20s, produce ~40s). Overflow goes to `skipped` and is reported, not silently accumulated.
5. **Interleave:** no two consecutive items on the same atom; don't cluster produce items at the end.

### Phase

Derived, never a setting, and not shown as a level.

- **foundation:** frequency-weighted coverage of the top-3000 list is under ~80% (roughly the first 800–1000 lemmas). New atoms come mainly from scenarios. Generation and adaptation are available but honest about it: a family history rewritten with 300 lemmas is a different text.
- **reading:** above that. Goal-text and mined atoms lead; scenarios remain available and keep supplying the rest of the 3000 list, but they are no longer the default source.

The threshold is a constant to tune against real use, not a gate: crossing it changes an ordering, nothing else.

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

3. **Adapt:** any passage can be rewritten at three levels (comfortable 98% known, balanced 95%, challenging 90%), keeping meaning, facts and order of ideas. The adaptation is stored as its own passage linked to the original. This is the rung-maker for goal texts (§11).

Generated, adapted and imported passages are treated identically downstream.

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

**Names don't count.** Proper nouns (capitalised mid-sentence and absent from the lexicon, or tagged PROPN by the NLP service, or marked "a name" by the learner in the tap sheet) are excluded from coverage and never offered for mining. A family history is full of them.

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
| produce | a situation, in English: "7am, a café near Gare de Lyon. You want a coffee, then change your mind to an americano." | free text in French | model checks against the target atoms, returns ok/fix, a natural version, and one line of notes; user confirms grade |

**Produce is situational.** Never "use X in a sentence". A `ProducePrompt` (§10) names a situation and the atoms it is fishing for. The grader is lenient the way a waiter is: *"Bonjour, je voudrais un café… euh, un americano, s'il vous plaît"* is a good answer, hesitation and all. It returns which target atoms were used acceptably. The scheduled atom gets the grade the learner confirms (suggested: understood and used it, Good; one without the other, Hard; neither, Again). Every *other* target the learner already knows and used well gets a Good of its own: that is real evidence. A target left unused gets nothing, since leaving a word out of a free answer says little about having forgotten it, and a target still `new` is never introduced this way. If an atom has no prompt, one is written from its domains and a sentence it was met in, and cached (at most three per session; the rest fall back to recall). With no API key, produce is not scheduled. Sessions hold at most three produce cards (five on push).

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
Le café, visit 2 · 6 new words · 1 grammar idea

Read · 4 min
"Le marché du samedi" · 95% known

Goal · La famille Martin
61% known · up 4 this week · gist available
```

The Learn row names the scenario visit the new atoms come from, or the goal text in the reading phase. The Goal row appears once a text is pinned.

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

## 10. Scenarios

How the first few thousand words arrive. A scenario is a situation you can stand in: a place, a person, something you need. It recurs, and each time it grows.

```
Le café
  visit 1  You landed at 7am. You want a coffee.            bonjour · je voudrais · un café · s'il vous plaît · merci
  visit 2  You change your mind; they ask "sur place ?"      un americano · à emporter · sur place · pardon · en fait
  visit 3  The order is wrong, and you'd like the bill.      ce n'est pas · j'ai commandé · l'addition · désolé
  visit 4  The barista asks where you're from.               je viens de · depuis · je suis ici pour · passé composé
```

This is a spiral, not a tree. Nothing is locked, no visit is ever "passed", and the scheduler never reads scenario state for due-ness. A scenario only decides which new atoms come next and gives them sentences to live in.

```ts
interface Scenario {
  id: string;
  slug: string;               // "cafe"
  title: string;              // "Le café"
  brief: string;              // L1, one or two sentences: where you are, who you're talking to
  domains: Domain[];
  origin: "seed" | "goal" | "custom";
  goalId?: string;            // for scenarios spun out of a goal text
  visits: ScenarioVisit[];
}

interface ScenarioVisit {
  id: string;
  scenarioId: string;
  n: number;
  brief: string;              // L1: what is different this time
  passageId: string;          // the dialogue; an ordinary Passage, sentences have origin "scenario"
  bundle: string[];           // atomIds new to the learner when the visit was made, in teaching order
  prompts: ProducePrompt[];
  createdAt: string;
  startedAt?: string;
}

interface ProducePrompt {
  id: string;
  visitId?: string;           // absent for prompts generated for non-scenario atoms
  situation: string;          // L1: "You want a coffee, then change your mind to an americano."
  targetAtomIds: string[];
  exampleAnswer: string;      // one natural French answer, shown after grading
}
```

### A visit

Opening a visit is what starts it; there is no separate "begin" step.

1. **The brief**, in English. Where you are, what you want.
2. **The dialogue**, 60–120 words, shown in the ordinary reader, so tap, gloss, translation and Why? all work. It is written from known atoms plus this visit's bundle and nothing else (names excepted). Every visit also carries the whole dialogue in English behind a toggle, so day one is readable with no model. Each line that holds a bundle atom is saved as a sentence (origin `scenario`), which is where that atom's cloze cards come from.
3. **The bundle:** 6–10 new atoms. Chunks first, then words, at most one grammar atom. They join the queue as `new` with `source: "scenario"`, in bundle order, under the usual daily cap, so a visit may take two days to absorb, and that is fine.
4. **Your turn:** one to three `ProducePrompt`s. On the visit itself these are a rehearsal: you type, you see a natural version, nothing is logged as a review. The prompts are kept, and return through the normal queue as graded produce cards once their atoms pass the 7-day stability mark (§4, §6). That is the "recurring" part: three weeks later you are back at the counter, cold.

### Where visits come from

- **Seed scenarios** ship in `db/seed/scenarios-fr.json`: about a dozen situations (arriving, the café, introductions, the bakery, getting around, a restaurant, where you're staying, dinner with the family, the pharmacy, making plans by text, saying what you did today, giving an opinion). Visit 1 of each ships written out, dialogue and bundle included, so a fresh install with no API key still has somewhere to start.
- **Later visits are generated**, one model call each, stored and never regenerated. Input: the scenario brief, one-line summaries of earlier visits, the known-atom list, and a candidate list: the highest-ranked unknown frequency-list lemmas, plus unknowns from the active goal text (§11). The model picks the 6–10 candidates that honestly fit the situation, invents the complication, and writes brief, dialogue and prompts. Because candidates are drawn from the top of the frequency list, scenarios sweep the 3000 roughly in rank order, but grouped by situation rather than by rank.
- **Goal scenarios** are spun out of a goal text's themes ("Your father-in-law is showing you the photo album"). They are how a goal text reaches back into the foundation phase.
- **Custom scenarios:** the learner types a situation ("meeting her grandmother on Sunday", "I'm in a rifugio and the only common language is French"). Same generator.

### Which visit next

The home screen's Learn row proposes one: the scenario least recently visited whose last bundle is mostly introduced (≥ ~80% no longer `new`), preferring goal scenarios when a goal is pinned. The learner can pick any other, or ask for the next visit of any scenario early. When no scenario has anything to offer and the daily allowance isn't used, the frequency fallback fills it.

Words that fit no counter or kitchen (*cependant*, *ainsi*, *plutôt*) come through the narrative scenarios (telling a story, giving an opinion), then through reading.

---

## 11. Goal texts

A text you can't read yet and want to. The running example: a long message from a father-in-law about the family's history.

Pin any imported passage as the goal. One active goal at a time; others wait in the library.

### On pinning

- **Sections.** Long texts are split at paragraph boundaries into sections of at most ~300 words, each an ordinary passage, so adaptation and coverage work per section as well as overall.
- **Names** are excluded from coverage (§5).
- **Prepare** (a button, needs the model; pinning itself is instant). Two calls run together: the goal's qualifying words that have no gloss are glossed, creating atoms for those outside the frequency list; and the grammar survey below.
- **Grammar survey.** One model call lists the grammar the text leans on that the learner lacks (for a written family history: imparfait, passé simple, relative clauses) and proposes grammar atoms with `source: "goal"`. Forms met only in writing are created **receptive-only** (`receptiveOnly: true` on the atom): the scheduler never asks for recall or produce. You need to read *il naquit*; you will never need to say it.
- The survey also proposes one or two **goal scenarios** (§10); each is written on request.

### What it changes

- **New-atom order** (§4). In the reading phase the goal's unknowns lead, ranked by occurrences in the goal, then frequency rank. In the foundation phase they only bias scenario bundles. A goal word qualifies for the queue if it appears at least twice in the goal or ranks in the top ~5000; one-off rarities are glossed in place in the reader instead of becoming cards.
- **Goal coverage** is recomputed against today's atoms and logged daily. It gets the Goal row on the home screen and its own chart on the stats screen. This number going up is the point of the app.

### The ladder

```
gist  →  comfortable  →  balanced  →  challenging  →  the original
```

- **gist:** a 5–8 sentence summary per section in the learner's own French. Available from ~300 known atoms. Honest label: "a summary, not the text."
- **comfortable / balanced / challenging:** the existing adaptation levels (§5), per section. Offered from the reading phase; before that the button says why not ("At 400 words this would stop being his letter").
- Each rung is a stored passage. The app recommends the highest rung whose *recomputed* coverage is at least 90%.
- **Rungs go stale.** One written for 400 lemmas is babyish at 900. A rung is regenerated on request once the known set has grown ~15% since it was written; the old one stays in the library.
- Reading a rung logs encounters like any passage, and mining from a rung works as usual. The tap sheet on a rung can show the original sentence it came from.

### Reached

Original coverage ≥ 95% and the learner has read it through. The goal is marked reached and stays in the library. One line, "You read it." No confetti. Pin the next one.

### Privacy

Goal texts are often personal. They are stored in the learner's database and sent to the model API for adaptation, and go nowhere else. This matters the day the app has a second user.

---

## 12. Repo layout

```
atomiclode/
  app/                 # Next.js routes
    (home)/
    read/
    review/
    scenario/          # v2: scenario list, visit screen
    goal/              # v2: pinned goal text, ladder
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
    scenarios/         # v2: visit generation, next-visit choice, produce prompts
    goals/             # v2: sectioning, goal coverage, ladder, new-atom order
    llm/               # prompts and thin API client
  db/
    schema.ts
    seed/              # frequency list, chunks, grammar atoms, seed scenarios
  nlp/                 # Python FastAPI + spaCy service
    main.py
    requirements.txt
  public/
  SPEC.md              # this file
```

## 13. Milestones

1. **Skeleton:** repo, Vercel deploy, DB schema, seed frequency list, home screen showing counts.
2. **Scheduler:** `lib/scheduler` with tests; review screen for recognize/recall; log + replay.
3. **Reader (import):** paste text → analysis via NLP service → coverage → tap-to-mine → cloze cards flow into reviews.
4. **Why + generate:** "why?" endpoint with caching; passage generation with stretch slider; passage library and reuse.
5. **Polish:** triage mode, intensity, encounter signals, stats screen, PWA install.

Usable for real French reading by the end of milestone 3. Milestones 1–5 are built.

**v2**

6. **Produce:** `ProducePrompt`, the situational produce card and its grader; until it lands, `planSession` stops emitting `produce`. Housekeeping alongside: the Dolomite rename, glosses exported back into the seed JSON.
7. **Scenarios:** schema, seed scenarios with visit 1 written out, the visit screen (brief → dialogue → bundle → your turn), `newOrder` passed into `planSession`, next-visit generation, custom scenarios, the Learn row.
8. **Goal texts:** pin and section, names out of coverage, goal coverage log and stats line, phase and goal-led ordering, the ladder with gist and staleness, grammar survey and receptive-only atoms, goal scenarios.

The cold start is fixed by the end of milestone 7; the father-in-law's letter is on the home screen by the end of 8.

## 14. Open questions

- Chunk detection beyond dictionary match (n-gram frequency over the user's passages?).
- Whether grammar atoms need a distinct decay model after a few months of log data.
- How much self-grading to keep once auto-check is reliable.
- Where the foundation/reading threshold really sits. 80% frequency-weighted coverage is a guess; the honest test is whether a "comfortable" adaptation of a real letter still reads like the letter.
- Whether generated scenario bundles sweep the frequency list well enough, or leave a residue of words that fit no situation and need a different home.
- In-visit produce as ungraded rehearsal: right, or a wasted data point?
- The lookup lemmatizer reads *j'ai marché* as the noun *marché* and *fatiguée* as *fatiguer*. Seed bundles are written around it; generated ones lose the odd word to it. Does it matter enough to make the spaCy service the default?
- More than one active goal, and what happens to the ordering when there are two.
- Greek as the second language: no spaCy model of equal quality; likely model-based lemmatization.
