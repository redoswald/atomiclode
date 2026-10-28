"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { isLang, LANG_COOKIE } from "@/lib/lang";

/** Header switch: which track (French or Greek) the app shows. Progress in each is kept apart by `atoms.lang`. */
export async function setLanguage(formData: FormData): Promise<void> {
  await requireAuth();
  const lang = String(formData.get("lang") ?? "");
  const back = String(formData.get("back") ?? "/");
  if (isLang(lang)) {
    const jar = await cookies();
    jar.set(LANG_COOKIE, lang, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/", "layout");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}
