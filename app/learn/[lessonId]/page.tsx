import { notFound, redirect } from "next/navigation";
import { Shell } from "@/app/components/shell";
import { db, hasDatabase } from "@/db";
import { courseLive } from "@/lib/course";
import { buildLesson } from "@/lib/course/lesson";
import { learner } from "@/lib/learner";
import { hasAnthropicKey } from "@/lib/llm/client";
import { buildSession } from "@/lib/review/session";
import { hasStt } from "@/lib/speech/stt";
import { LessonPlayer } from "./player";

export const dynamic = "force-dynamic";

/** Two minutes of due reviews before the lesson (SPEC §17 Warm-up). */
const WARMUP_MIN = 2;

export default async function LessonPage({ params, searchParams }: PageProps<"/learn/[lessonId]">) {
  const { lessonId } = await params;
  const refresh = (await searchParams).refresh === "1";
  if (!hasDatabase()) notFound();
  const me = await learner();
  if (!courseLive(me.lang)) redirect("/learn");
  const d = db();
  let lesson;
  try {
    lesson = await buildLesson(d, me, lessonId, { canSay: hasStt(), refresh });
  } catch {
    redirect("/learn");
  }
  const warmup = lesson.replay || lesson.refresh ? undefined : await buildSession(d, me, "steady", new Date(), { timeBudgetMin: WARMUP_MIN, newAtomsPerDay: 0, produce: false });

  return (
    <Shell back={{ href: "/learn", label: "Learn" }} nav={false}>
      <LessonPlayer lesson={lesson} warmup={warmup && warmup.cards.length ? warmup : undefined} canWhy={hasAnthropicKey()} />
    </Shell>
  );
}
