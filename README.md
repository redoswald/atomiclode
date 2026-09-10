# Lode

A language-learning app for adults: honest spaced repetition, a reader that turns real text into review material, and a "why?" button. French first. See [SPEC.md](./SPEC.md) for the full design.

## Status

Milestone 2: the scheduler (`lib/scheduler`, FSRS via `ts-fsrs`) and a review screen for recognize and recall. Reviews are logged append-only and memory state can be rebuilt from the log (`npm run db:replay`). Reading arrives in milestone 3.

## Stack

- Next.js 16 (App Router) · TypeScript · Tailwind 4, deployed on Vercel
- Postgres on Neon via Drizzle (`db/schema.ts`, migrations in `drizzle/`)
- Anthropic API for glosses, explanations, and generation (`@anthropic-ai/sdk`)
- Python FastAPI + spaCy service for tokenization (milestone 3, `nlp/`)

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

For `DATABASE_URL`, create a free Neon project and use its connection string. A Neon branch per developer avoids running Postgres locally.

### Glosses

The frequency list ships without English glosses, and words can't be introduced until they have one. Two ways to fill them:

- **From the app** (no terminal): set `ANTHROPIC_API_KEY` in Vercel, redeploy, and press *Fill glosses* on the home page. It works through the database in batches of 40. Later, `npm run seed:export` copies those glosses back into `db/seed/frequency-fr.json` so they can be committed.
- **From a terminal**: with `ANTHROPIC_API_KEY` in `.env.local`, `npm run seed:gloss` fills the JSON directly (resumable), then `npm run db:seed` pushes it. Commit the JSON either way.

Re-seeding never blanks a gloss that was filled in the app.

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
app/            Next.js routes: home, /review, /login, server actions
lib/atoms/      types, seed-row builders, home-screen counts
lib/auth.ts     APP_SECRET cookie auth (proxy.ts enforces it)
lib/scheduler/  planSession, applyReview, replay, FSRS wrapper + tests
lib/review/     session builder, review recording, lenient answer matching
lib/llm/        Anthropic client and gloss prompt
lib/reader/     passage analysis client (milestone 3)
lib/llm/        prompts and API client (milestone 4)
db/             Drizzle schema, client, seed data and runner
drizzle/        generated SQL migrations
scripts/        one-off tooling (gloss filling)
nlp/            Python spaCy service (milestone 3)
```
