/**
 * API v1 endpoints (SPEC §19), as functions of (db, learner, input). The route
 * files only parse the request and call these, so every endpoint is testable
 * against PGlite. Nothing here is new learning logic: it wraps the course,
 * review, scene, speech and progress code the web app already uses.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { atoms, producePrompts, scenarios, scenarioVisits } from "@/db/schema";
import { displayKey } from "@/lib/atoms/display";
import type { Grade, Modality } from "@/lib/atoms/types";
import type { AppUser } from "@/lib/auth";
import { completedLessons, courseFor, courseLive } from "@/lib/course";
import type { ItemStats } from "@/lib/course/exercises";
import { fadedLessons } from "@/lib/course/fading";
import { buildLesson, completeCheckpoint, completeLesson, completeRefresh, currentCheckpoint, type LessonPayload } from "@/lib/course/lesson";
import { levelProgress, pathStates, unitProgress } from "@/lib/course/path";
import { isLang, LANGS, LANG_SPECS, type Lang } from "@/lib/lang";
import type { Learner } from "@/lib/learners/provision";
import { awardXp, DAILY_GOALS, progressFor, reviewXp, saveSettings, validTimeZone, XP } from "@/lib/progress/xp";
import { openPassage } from "@/lib/reader/passages";
import { checkProduce, recordProduce, type ProduceCheck } from "@/lib/review/produce";
import { recordReview, type RecordReviewResult } from "@/lib/review/record";
import { buildSession, parseIntensity, ROUND_MIN, type BuiltSession } from "@/lib/review/session";
import { MODALITIES } from "@/lib/atoms/types";
import { scenarioStates, startVisit } from "@/lib/scenarios/visits";
import { dialogueLines, spokenText, type VoiceIndex } from "@/lib/speech/say";
import { hasStt } from "@/lib/speech/stt";
import { answeredAt, badRequest, notFound, withReceipt, type Capabilities } from "./http";
import type { MeResponse, PathResponse, ReviewRound, SceneResponse } from "./types";

// ---- me and settings -------------------------------------------------------------------

export async function getMe(d: Db, user: AppUser, me: Learner, now = new Date()): Promise<MeResponse> {
  const p = await progressFor(d, user.id, now);
  return {
    user: { id: user.id, email: user.email, name: user.name },
    lang: me.lang,
    tracks: LANGS.map((l) => ({ lang: l, name: LANG_SPECS[l].name, nativeName: LANG_SPECS[l].nativeName, courseLive: courseLive(l) })),
    settings: p.settings,
    dailyGoals: DAILY_GOALS.map((g) => ({ ...g })),
    today: p.today,
    todayXp: p.todayXp,
    totalXp: p.totalXp,
    streak: p.streak,
  };
}

export async function patchSettings(d: Db, user: AppUser, body: { dailyGoal?: unknown; timeZone?: unknown }): Promise<{ ok: true }> {
  const patch: { dailyGoal?: number; timeZone?: string } = {};
  if (body.dailyGoal !== undefined) {
    if (!DAILY_GOALS.some((g) => g.xp === body.dailyGoal)) throw badRequest(`dailyGoal must be one of ${DAILY_GOALS.map((g) => g.xp).join(", ")}`);
    patch.dailyGoal = body.dailyGoal as number;
  }
  if (body.timeZone !== undefined) {
    const tz = validTimeZone(typeof body.timeZone === "string" ? body.timeZone : undefined);
    if (!tz) throw badRequest("timeZone must be an IANA zone, e.g. Europe/Athens");
    patch.timeZone = tz;
  }
  await saveSettings(d, user.id, patch);
  return { ok: true };
}

// ---- the path --------------------------------------------------------------------------

export async function getPath(d: Db, me: Learner, now = new Date()): Promise<PathResponse> {
  const course = courseFor(me.lang);
  if (!course || !courseLive(me.lang)) return { lang: me.lang, live: false, units: [] };
  const done = await completedLessons(d, me);
  const faded = await fadedLessons(d, me, now);
  const path = pathStates(course, done);
  const slugs = course.units.flatMap((u) => u.scenes);
  const scenes = slugs.length
    ? await d
        .select({ id: scenarios.id, slug: scenarios.slug })
        .from(scenarios)
        .where(and(eq(scenarios.userId, me.userId), inArray(scenarios.slug, slugs)))
    : [];
  const sceneId = new Map(scenes.map((s) => [s.slug, s.id]));
  return {
    lang: me.lang,
    live: true,
    units: course.units.map((u) => {
      const level = u.cefr.split(".")[0];
      return {
        id: u.id,
        cefr: u.cefr,
        title: u.title,
        canDo: u.canDo,
        progress: unitProgress(u, done),
        level: { name: level, share: levelProgress(course, done, level) },
        lessons: path
          .filter((p) => p.unit.id === u.id)
          .map((p) => ({
            id: p.lesson.id,
            n: p.n,
            title: p.lesson.title,
            kind: p.lesson.kind,
            state: p.state,
            faded: p.state === "done" && faded.has(p.lesson.id),
            letters: p.lesson.letters ?? [],
            preview: p.lesson.items.slice(0, 4).map((i) => i.key),
            sceneId: p.lesson.scene ? (sceneId.get(p.lesson.scene) ?? null) : null,
          })),
      };
    }),
  };
}

// ---- lessons ---------------------------------------------------------------------------

export async function getLesson(d: Db, me: Learner, lessonId: string, caps: Capabilities, opts: { refresh?: boolean; now?: Date; rnd?: () => number } = {}): Promise<{ lesson: LessonPayload; warmup: ReviewRound | null }> {
  const lesson = await buildLesson(d, me, lessonId, { canSay: hasStt(), refresh: opts.refresh, now: opts.now, exercises: caps.exercises, rnd: opts.rnd });
  const warmup =
    lesson.replay || lesson.refresh
      ? null
      : roundOf(await buildSession(d, me, "steady", opts.now ?? new Date(), { timeBudgetMin: 2, newAtomsPerDay: 0, produce: false, modalities: caps.cards }), 1);
  return { lesson, warmup: warmup && warmup.cards.length ? warmup : null };
}

export interface CompleteLessonBody {
  clientId?: unknown;
  answeredAt?: unknown;
  refresh?: unknown;
  stats?: unknown;
}

function parseStats(v: unknown): Record<string, ItemStats> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, ItemStats> = {};
  for (const [id, s] of Object.entries(v as Record<string, unknown>)) {
    const x = s as Partial<ItemStats>;
    out[id] = { attempts: Number(x.attempts) || 0, misses: Number(x.misses) || 0, firstTimeRight: x.firstTimeRight !== false };
  }
  return out;
}

export async function postLessonComplete(d: Db, me: Learner, lessonId: string, body: CompleteLessonBody, now = new Date()) {
  const { at, clamped } = answeredAt(body.answeredAt, now);
  const stats = parseStats(body.stats);
  return withReceipt(d, me.userId, body.clientId, `lesson:${lessonId}`, async () => {
    if (body.refresh === true) {
      const r = await completeRefresh(d, me, lessonId, stats, at);
      await awardXp(d, me, "refresh", XP.refresh, undefined, at);
      return { kind: "refresh" as const, reviewed: r.reviewed, xp: XP.refresh, clamped };
    }
    const r = await completeLesson(d, me, lessonId, stats, at);
    const clean = Object.values(stats).every((s) => s.firstTimeRight);
    const xp = r.replay ? XP.lessonReplay : XP.lesson + (clean ? XP.lessonClean : 0);
    await awardXp(d, me, "lesson", xp, r.replay ? undefined : lessonId, at);
    return { kind: "lesson" as const, ...r, xp, clamped };
  });
}

// ---- reviews ---------------------------------------------------------------------------

function roundOf(s: BuiltSession, round: number): ReviewRound {
  return {
    round,
    intensity: s.intensity,
    minutes: s.timeBudgetMin,
    cards: s.cards,
    left: { ...s.left, rounds: Math.ceil(s.left.minutes / ROUND_MIN) },
    deferred: s.plan.deferred,
  };
}

export async function getReview(d: Db, me: Learner, caps: Capabilities, q: { intensity?: string | null; round?: string | null }, now = new Date()): Promise<ReviewRound> {
  const round = Math.max(1, Math.min(99, Number(q.round) || 1));
  const s = await buildSession(d, me, parseIntensity(q.intensity), now, { round: true, modalities: caps.cards, produce: caps.cards.has("produce") ? undefined : false });
  return roundOf(s, round);
}

export interface ReviewBody {
  clientId?: unknown;
  answeredAt?: unknown;
  atomId?: unknown;
  modality?: unknown;
  grade?: unknown;
  responseMs?: unknown;
  sentenceId?: unknown;
}

export async function postReview(d: Db, me: Learner, body: ReviewBody, now = new Date()): Promise<RecordReviewResult & { xp: number; clamped: boolean }> {
  const { at, clamped } = answeredAt(body.answeredAt, now);
  if (typeof body.atomId !== "string") throw badRequest("atomId is required");
  if (!MODALITIES.includes(body.modality as Modality)) throw badRequest("unknown modality");
  if (![1, 2, 3, 4].includes(body.grade as number)) throw badRequest("grade must be 1–4");
  const modality = body.modality as Modality;
  return withReceipt(d, me.userId, body.clientId, "review", async () => {
    const r = await recordReview(
      d,
      me.userId,
      { atomId: body.atomId as string, modality, grade: body.grade as Grade, responseMs: Number(body.responseMs) || 0, sentenceId: typeof body.sentenceId === "string" ? body.sentenceId : undefined },
      at,
    );
    const xp = reviewXp(modality);
    await awardXp(d, me, "review", xp, undefined, at);
    return { ...r, xp, clamped };
  });
}

export async function postProduceCheck(d: Db, me: Learner, body: { promptId?: unknown; answer?: unknown }): Promise<ProduceCheck> {
  if (typeof body.promptId !== "string" || typeof body.answer !== "string") throw badRequest("promptId and answer are required");
  return checkProduce(d, me.userId, body.promptId, body.answer);
}

export async function postProduce(
  d: Db,
  me: Learner,
  body: ReviewBody & { promptId?: unknown; usedAtomIds?: unknown },
  now = new Date(),
): Promise<RecordReviewResult & { xp: number; clamped: boolean }> {
  const { at, clamped } = answeredAt(body.answeredAt, now);
  if (typeof body.atomId !== "string" || typeof body.promptId !== "string") throw badRequest("atomId and promptId are required");
  if (![1, 2, 3, 4].includes(body.grade as number)) throw badRequest("grade must be 1–4");
  return withReceipt(d, me.userId, body.clientId, "produce", async () => {
    const r = await recordProduce(
      d,
      me.userId,
      {
        atomId: body.atomId as string,
        promptId: body.promptId as string,
        grade: body.grade as Grade,
        responseMs: Number(body.responseMs) || 0,
        usedAtomIds: Array.isArray(body.usedAtomIds) ? body.usedAtomIds.filter((x): x is string => typeof x === "string") : [],
      },
      at,
    );
    const xp = reviewXp("produce");
    await awardXp(d, me, "review", xp, undefined, at);
    return { ...r, xp, clamped };
  });
}

// ---- scenes ----------------------------------------------------------------------------

/** A scene's current visit, opened (opening a visit is what starts it, as on the web). */
export async function getScene(d: Db, me: Learner, sceneId: string, visitN?: number): Promise<SceneResponse> {
  const [row] = await d.select({ lang: scenarios.lang }).from(scenarios).where(and(eq(scenarios.id, sceneId), eq(scenarios.userId, me.userId)));
  if (!row) throw notFound("unknown scene");
  const lang: Lang = isLang(row.lang) ? row.lang : "fr";
  const state = (await scenarioStates(d, { userId: me.userId, lang })).find((s) => s.scenario.id === sceneId);
  if (!state) throw new Error("That scene isn't open yet.");
  const current = state.visits.find((v) => v.visit.n === visitN) ?? state.latest;
  const scenario = { id: state.scenario.id, slug: state.scenario.slug, title: state.scenario.title, brief: state.scenario.brief };
  if (!current) return { lang, scenario, visit: null };

  await startVisit(d, me.userId, current.visit.id);
  const [view, bundle, prompts, checkpoint] = await Promise.all([
    current.visit.passageId ? openPassage(d, me.userId, current.visit.passageId) : undefined,
    current.visit.bundle.length
      ? d.select().from(atoms).where(and(eq(atoms.userId, me.userId), inArray(atoms.id, current.visit.bundle)))
      : [],
    d
      .select()
      .from(producePrompts)
      .where(and(eq(producePrompts.userId, me.userId), eq(producePrompts.visitId, current.visit.id)))
      .orderBy(producePrompts.createdAt),
    courseLive(lang) ? currentCheckpoint(d, { userId: me.userId, lang }, state.scenario.slug) : undefined,
  ]);
  const text = view ? view.tokens.map((t) => t.pre + t.surface).join("") : "";
  const translations = current.visit.translation.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines = dialogueLines(text);
  return {
    lang,
    scenario,
    visit: {
      id: current.visit.id,
      n: current.visit.n,
      of: state.visits.length,
      brief: current.visit.brief,
      lines: lines.map((l, i) => ({ text: l.text, voice: l.voice as VoiceIndex, translation: translations.at(i)?.replace(/^[—–-]\s*/, "") ?? null })),
      bundle: current.visit.bundle.flatMap((id) => {
        const a = bundle.find((b) => b.id === id);
        if (!a || a.type === "grammar") return [];
        const shown = { lang, type: a.type, key: a.key, forms: a.forms, pos: a.pos ?? undefined, gender: a.gender ?? undefined, domains: a.domains };
        return [{ atomId: a.id, display: displayKey(shown), gloss: a.gloss, romanization: a.romanization, speak: spokenText(shown) ?? null, status: a.status }];
      }),
      prompts: prompts.map((p) => ({ id: p.id, situation: p.situation, exampleAnswer: p.exampleAnswer })),
      checkpointLessonId: checkpoint ?? null,
    },
  };
}

/** A visit's "your turn", all answered: the scene's XP, once per visit (SPEC §18). */
export async function postSceneTurnDone(d: Db, me: Learner, visitId: string, at = new Date()): Promise<{ xp: number }> {
  const [visit] = await d
    .select({ id: scenarioVisits.id })
    .from(scenarioVisits)
    .where(and(eq(scenarioVisits.id, visitId), eq(scenarioVisits.userId, me.userId), isNotNull(scenarioVisits.startedAt)));
  if (!visit) throw notFound("unknown visit");
  await awardXp(d, me, "scene", XP.scene, `visit:${visit.id}`, at);
  return { xp: XP.scene };
}

export async function postCheckpoint(d: Db, me: Learner, lessonId: string, at = new Date()): Promise<{ ok: true }> {
  await completeCheckpoint(d, me, lessonId, at);
  return { ok: true };
}
