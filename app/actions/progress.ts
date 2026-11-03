"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { scenarioVisits } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { learner } from "@/lib/learner";
import { awardXp, DAILY_GOALS, getSettings, saveSettings, validTimeZone, XP } from "@/lib/progress/xp";

/** The browser's time zone, so days and streaks follow the learner's own midnight. */
export async function syncTimeZone(tz: string): Promise<boolean> {
  const user = await getUser();
  const zone = validTimeZone(tz);
  if (!user || !zone) return false;
  const current = await getSettings(db(), user.id);
  if (current.timeZone !== zone) await saveSettings(db(), user.id, { timeZone: zone });
  return true;
}

export async function setDailyGoal(formData: FormData): Promise<void> {
  const me = await learner();
  const xp = Number(formData.get("goal"));
  if (DAILY_GOALS.some((g) => g.xp === xp)) await saveSettings(db(), me.userId, { dailyGoal: xp });
  revalidatePath("/stats");
  revalidatePath("/");
}

/** A scene visit's "your turn", all answered: the scene's XP, once per visit. */
export async function sceneTurnDone(visitId: string): Promise<void> {
  const me = await learner();
  const d = db();
  const [visit] = await d
    .select({ id: scenarioVisits.id })
    .from(scenarioVisits)
    .where(and(eq(scenarioVisits.id, visitId), eq(scenarioVisits.userId, me.userId), isNotNull(scenarioVisits.startedAt)));
  if (visit) await awardXp(d, me, "scene", XP.scene, `visit:${visit.id}`);
}
