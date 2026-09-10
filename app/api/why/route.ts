/**
 * POST /api/why { atomId?, lemma?, surface?, sentence? }  (SPEC §7)
 * Same logic as the `why` server action, exposed as JSON for other clients.
 */
import { NextResponse, type NextRequest } from "next/server";
import { db, hasDatabase } from "@/db";
import { isAuthenticated } from "@/lib/auth";
import { hasAnthropicKey } from "@/lib/llm/client";
import { askWhy, type WhyRequest } from "@/lib/reader/why";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ error: "no database" }, { status: 503 });
  if (!hasAnthropicKey()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 503 });

  let body: WhyRequest;
  try {
    body = (await request.json()) as WhyRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.atomId && !body.lemma) return NextResponse.json({ error: "atomId or lemma is required" }, { status: 400 });

  try {
    const answer = await askWhy(db(), {
      atomId: typeof body.atomId === "string" ? body.atomId : undefined,
      lemma: typeof body.lemma === "string" ? body.lemma : undefined,
      surface: typeof body.surface === "string" ? body.surface : undefined,
      sentence: typeof body.sentence === "string" ? body.sentence : undefined,
    });
    return NextResponse.json(answer);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
