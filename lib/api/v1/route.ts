/**
 * The shell every API v1 route runs in: database check, bearer auth, the learner,
 * the client's capabilities, JSON out, errors as `{ error: { code, message } }`.
 */
import { NextResponse } from "next/server";
import { db, hasDatabase, type Db } from "@/db";
import type { AppUser } from "@/lib/auth";
import type { Learner } from "@/lib/learners/provision";
import { apiLearner } from "./auth";
import { ApiError, errorResponse, parseCapabilities, type Capabilities } from "./http";

export interface Ctx {
  d: Db;
  user: AppUser;
  me: Learner;
  caps: Capabilities;
  url: URL;
}

export async function api(request: Request, run: (ctx: Ctx) => Promise<unknown>): Promise<Response> {
  try {
    if (!hasDatabase()) throw new ApiError(503, "unavailable", "No database configured.");
    const d = db();
    const { user, me } = await apiLearner(d, request);
    const out = await run({ d, user, me, caps: parseCapabilities(request.headers.get("x-dolomite-client")), url: new URL(request.url) });
    return out instanceof Response ? out : NextResponse.json(out);
  } catch (err) {
    return errorResponse(err);
  }
}

/** The JSON body, or a 400. */
export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "bad_request", "Expected a JSON body.");
  }
}
