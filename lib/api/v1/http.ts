/**
 * API v1 plumbing (SPEC §19): stable error codes, the capability header, time
 * clamping for answers given offline, and receipts for idempotent submissions.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/db";
import { apiReceipts } from "@/db/schema";
import type { Modality } from "@/lib/atoms/types";
import type { Exercise } from "@/lib/course/exercises";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const notFound = (what = "not found") => new ApiError(404, "not_found", what);

/** `{ error: { code, message } }`: `code` is stable for the app, `message` is for people. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  const message = err instanceof Error ? err.message : String(err);
  // The domain layer throws plain errors with readable messages; map the known ones.
  const code = /isn't open yet/.test(message)
    ? "lesson_locked"
    : /^unknown /.test(message)
      ? "not_found"
      : /Nothing in this lesson needs a refresh|Only a finished lesson|Open the scene first|not a checkpoint/.test(message)
        ? "conflict"
        : "error";
  const status = code === "lesson_locked" || code === "conflict" ? 409 : code === "not_found" ? 404 : 500;
  return NextResponse.json({ error: { code, message } }, { status });
}

// ---- capabilities ------------------------------------------------------------------

export type ExerciseKind = Exercise["kind"];
export const ALL_EXERCISES: readonly ExerciseKind[] = ["meaning", "hear", "decode", "pairs", "build", "say", "sound"];
export const ALL_CARDS: readonly Modality[] = ["recognize", "recall", "cloze", "decode", "listen", "produce"];

export interface Capabilities {
  client: string;
  exercises: Set<ExerciseKind>;
  cards: Set<Modality>;
}

/**
 * `X-Dolomite-Client: ios/1.0; exercises=meaning,hear,…; cards=recognize,recall,…`.
 * Without the header (curl, tests) everything is assumed; an app always sends it,
 * and gets only what it lists (SPEC §19).
 */
export function parseCapabilities(header: string | null): Capabilities {
  const parts = (header ?? "").split(";").map((p) => p.trim()).filter(Boolean);
  const field = (name: string) => parts.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1).split(",").map((x) => x.trim());
  const ex = field("exercises");
  const cards = field("cards");
  return {
    client: parts.find((p) => !p.includes("=")) ?? "unknown",
    exercises: new Set((ex ?? ALL_EXERCISES).filter((k): k is ExerciseKind => (ALL_EXERCISES as readonly string[]).includes(k))),
    // Recognize is the floor every client can draw.
    cards: new Set([...(cards ?? ALL_CARDS).filter((k): k is Modality => (ALL_CARDS as readonly string[]).includes(k)), "recognize"]),
  };
}

export { degradeModality } from "@/lib/scheduler/modality";

// ---- time --------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** How far back an offline answer may claim to have been given. */
export const MAX_ANSWER_AGE_DAYS = 30;

/**
 * Answers carry the time they were given (SPEC §19 rule 1). A future time or one
 * older than 30 days is clamped to now or to the limit, and flagged.
 */
export function answeredAt(value: unknown, now = new Date()): { at: Date; clamped: boolean } {
  if (typeof value !== "string") return { at: now, clamped: false };
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw badRequest("answeredAt must be an ISO date-time");
  if (t > now.getTime() + 60_000) return { at: now, clamped: true };
  const floor = now.getTime() - MAX_ANSWER_AGE_DAYS * DAY_MS;
  if (t < floor) return { at: new Date(floor), clamped: true };
  return { at: new Date(t), clamped: false };
}

// ---- receipts ----------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `apply` once per client id: a repeat returns the first response unchanged
 * (SPEC §19 idempotent submissions).
 */
export async function withReceipt<T>(d: Db, userId: string, clientId: unknown, kind: string, apply: () => Promise<T>): Promise<T> {
  if (typeof clientId !== "string" || !UUID.test(clientId)) throw badRequest("clientId must be a UUID");
  const [seen] = await d
    .select({ response: apiReceipts.response, kind: apiReceipts.kind })
    .from(apiReceipts)
    .where(and(eq(apiReceipts.userId, userId), eq(apiReceipts.clientId, clientId)));
  if (seen) {
    if (seen.kind !== kind) throw new ApiError(409, "client_id_reused", "That clientId was already used for something else.");
    return seen.response as T;
  }
  const response = await apply();
  await d.insert(apiReceipts).values({ userId, clientId, kind, response: response as object }).onConflictDoNothing();
  return response;
}
