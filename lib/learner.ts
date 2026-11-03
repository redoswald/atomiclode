/**
 * Who this request acts for. Every page and server action that touches learner
 * data starts here: it requires a signed-in, allowed user, reads the track
 * cookie, and makes sure that user's starter content for the track exists.
 */
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { getUser, type AppUser } from "@/lib/auth";
import { currentLang } from "@/lib/lang-server";
import { claimLegacy, ensureLearner, type Learner } from "@/lib/learners/provision";

export type { Learner } from "@/lib/learners/provision";

/** LEGACY_OWNER_EMAIL gets the data written before per-user accounts, on their first sign-in. */
function isLegacyOwner(user: AppUser): boolean {
  const owner = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase();
  return Boolean(owner) && user.email.toLowerCase() === owner;
}

export const learner = cache(async (): Promise<Learner> => {
  const user = await getUser();
  if (!user) redirect("/login");
  const lang = await currentLang();
  const d = db();
  if (isLegacyOwner(user)) await claimLegacy(d, user.id);
  await ensureLearner(d, user.id, lang);
  return { userId: user.id, lang };
});
