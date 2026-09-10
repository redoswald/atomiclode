# Lode

A language-learning app for adults: honest spaced repetition, a reader that turns real text into review material, and a "why?" button. French first. See [SPEC.md](./SPEC.md) for the full design.

## Status

Milestone 5 (polish): a visual system (warm paper, serif display type, sage accent, bottom tabs), *Adapt this text* at three levels, sentence translations in the tap sheet, a Stats screen with coverage over time, exposure signals from reading feeding the scheduler, an Explore box, and a PWA manifest so the app installs to the home screen. Milestone 4: "Why?" explanations and passage generation. Every word in the reader and every review card has a *Why?* that explains it in 3–6 sentences using the sentence at hand, cached per atom and per sentence; when the explanation names a grammar concept the app offers to add it as a grammar atom. *Read something new* serves a passage from your library whose coverage fits what you know today, or generates one (genre, topic, stretch slider, due words worked in). Earlier milestones: reader with import, coverage, tap-to-mine and cloze cards; scheduler and review screen; append-only review log with replay (`npm run db:replay`). Next: triage, intensity polish, exposure signals, stats, PWA (milestone 5).

## Stack

- Next.js 16 (App Router) · TypeScript · Tailwind 4, deployed on Vercel
- Postgres on Neon via Drizzle (`db/schema.ts`, migrations in `drizzle/`)
- Anthropic API for glosses, explanations, and generation (`@anthropic-ai/sdk`)
- Built-in French tokenizer and lookup lemmatizer (`lib/reader`, table from Lexique 3.83), with an optional spaCy service (`nlp/`) for context-aware lemmas

## Local setup (macOS)

Node is a system tool; install it with Homebrew if it is missing (`brew install node`). Everything else is project-local.

```bash
# npm (project-local; nothing global)
npm install
cp .env.example .env.local     # fill in DATABASE_URL at minimum

npm run db:prepare             # apply migrations and load seed atoms (idempotent)
npm run dev                    # http://localhost:3000
```

`npm run build` runs `db:prepare` first, so a Vercel build with `DATABASE_URL` set migrates and seeds on its own. Without `DATABASE_URL` the step is skipped and the build still succeeds.

For `DATABASE_URL`, create a free Neon project and use its connection string. Or skip Neon entirely for local work: `DATABASE_URL=pglite://./.pglite` runs an embedded Postgres in that folder (dev only; the folder is gitignored).

### Glosses

The frequency list ships without English glosses, and words can't be introduced until they have one. Two ways to fill them:

- **From the app** (no terminal): set `ANTHROPIC_API_KEY` in Vercel, redeploy, and press *Fill glosses* on the home page. It works through the database in batches of 40. Later, `npm run seed:export` copies those glosses back into `db/seed/frequency-fr.json` so they can be committed.
- **From a terminal**: with `ANTHROPIC_API_KEY` in `.env.local`, `npm run seed:gloss` fills the JSON directly (resumable), then `npm run db:seed` pushes it. Commit the JSON either way.

Re-seeding never blanks a gloss that was filled in the app.

### Reader analysis

Passages are tokenized and lemmatized inside the app with a Lexique-derived table (`lib/reader/lexicon-fr.json`, built by `db/seed/build-lexicon.py`), so no second service is required. For better lemmas in context, deploy `nlp/` (FastAPI + spaCy `fr_core_news_md`; the Dockerfile works on Railway or Fly.io), set `NLP_SERVICE_TOKEN` there, and set `NLP_SERVICE_URL` and `NLP_SERVICE_TOKEN` in Vercel. The app switches automatically and falls back to the built-in analysis if the service is unreachable. Local run of the service is described at the top of `nlp/main.py`.

### "Why?" endpoint

`POST /api/why` with `{ atomId }` or `{ lemma, surface, sentence }` returns `{ explanation, grammar?, cached }`. The UI uses the same logic through a server action. One model call per (atom, sentence), cached in `why_cache`; generic explanations also live on `atoms.explanation`.

### Generation and the library

Before generating, the app looks for an existing passage (imported or generated) whose coverage against today's atoms is within −4/+2 points of the stretch target, that contains some of the due words if asked, and that hasn't been read in the last 7 days. Otherwise it generates one 150–300 word passage constrained to your known lemmas and stores it. One unread generated passage at a time.

### Stats and exposure signals

Stats buckets known atoms into strong (stability ≥ 21 days), developing, and fragile (lapsed this week, or tapped 3+ times in 7 days in the reader). Coverage is the frequency-weighted share of the top-3000 list you know; the line uses the review log (a word counts from its first review or from when you marked it known). Reading also feeds the scheduler: an untapped encounter with a known word bumps its stability a little (capped, never skipping a review); a word you keep tapping is pulled forward. `db:replay` honours both.

### Sign-in

Set `APP_SECRET` to any long random string and the app asks for it once per browser (a signed, httpOnly cookie for a year). Without it the app is open to anyone with the URL, and the home page says so.

### Regenerating the frequency list

`db/seed/frequency-fr.json` is derived from Lexique 3.83 (CC BY-SA 4.0, New, Pallier, Brysbaert & Ferrand) by `db/seed/build-frequency.py`. Run it in a conda env, with pip inside that env for the PyPI-only package:

```bash
conda create -n lode-nlp python=3.12
conda activate lode-nlp
pip install pylexique           # bundles Lexique383.txt
python db/seed/build-frequency.py
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest: seed-file checks plus an integration test that runs the real migrations and seed against in-memory Postgres (PGlite) |
| `npm run db:generate` | Generate a migration from `db/schema.ts` |
| `npm run db:prepare` | Apply migrations, then upsert seed atoms (idempotent; runs automatically before `build`) |
| `npm run db:migrate` | Apply migrations only |
| `npm run db:seed` | Upsert seed atoms only (never touches memory state) |
| `npm run seed:gloss` | Fill empty glosses in the JSON via the Anthropic API |
| `npm run seed:export` | Copy glosses from the database back into the JSON |
| `npm run db:replay` | Rebuild every atom's memory state from the review log (after a scheduler change) |

## Deploying on Vercel

1. Import the GitHub repo in Vercel; the Next.js preset is detected automatically.
2. In the project's **Storage** tab, create a **Neon** Postgres database and connect it. This injects `DATABASE_URL`.
3. Redeploy. The build applies migrations and loads the seed atoms; no terminal needed.
4. Set `APP_SECRET` (sign-in) and `ANTHROPIC_API_KEY` (glosses, later explanations and generation), then redeploy. `NLP_SERVICE_URL` and `NLP_SERVICE_TOKEN` are not needed until milestone 3.

## Layout

```
app/            Next.js routes: home, /review, /read, /stats, /login, server actions, shell + tab bar
lib/atoms/      types, seed-row builders, home-screen counts
lib/auth.ts     APP_SECRET cookie auth (proxy.ts enforces it)
lib/scheduler/  planSession, applyReview, replay, FSRS wrapper + tests
lib/review/     session builder, review recording, lenient answer matching
lib/llm/        Anthropic client and gloss prompt
lib/reader/     tokenizer + lexicon, chunk matching, coverage, passages, URL import
lib/llm/        prompts and API client (milestone 4)
db/             Drizzle schema, client, seed data and runner
drizzle/        generated SQL migrations
scripts/        one-off tooling (gloss filling)
nlp/            optional Python spaCy service (FastAPI, Dockerfile)
```
