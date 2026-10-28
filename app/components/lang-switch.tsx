import { setLanguage } from "@/app/actions/lang";
import { LANG_SPECS, LANGS } from "@/lib/lang";
import { currentLang } from "@/lib/lang-server";

/** Header toggle between the tracks. Server component: reads the cookie, posts the switch. */
export async function LangSwitch() {
  const lang = await currentLang();
  return (
    <form action={setLanguage} className="flex items-center gap-1 rounded-full border border-line p-0.5 text-xs" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          type="submit"
          name="lang"
          value={l}
          lang={l}
          aria-pressed={l === lang}
          className={`rounded-full px-2.5 py-1 ${l === lang ? "bg-sage text-sage-ink" : "text-muted"}`}
        >
          {LANG_SPECS[l].nativeName}
        </button>
      ))}
    </form>
  );
}
