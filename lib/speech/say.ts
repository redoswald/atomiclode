/**
 * What a card or a line says out loud (SPEC §15). Pure, and safe in the browser:
 * the review screen and the reader both build clip requests from it.
 */
import { LANG_SPECS, type Gender, type Lang } from "@/lib/lang";

/** Longest text the speech route will voice. */
export const MAX_SPEECH_CHARS = 400;

export type SpeechRate = "normal" | "slow";
/** Which of the language's two voices: 0 for words, 0 and 1 taking turns in a dialogue. */
export type VoiceIndex = 0 | 1;

/**
 * Letters have no sound of their own a voice will say reliably, so each says its
 * name and one everyday word that starts with it. Combinations have no names: just
 * the example. Keys match the alphabet atoms (`letter:α`); the last four are the
 * combinations §16 adds.
 */
export const LETTER_SAY: Record<string, string> = {
  "letter:α": "άλφα, αέρας",
  "letter:β": "βήτα, βάρκα",
  "letter:γ": "γάμα, γάλα",
  "letter:δ": "δέλτα, δέντρο",
  "letter:ε": "έψιλον, ελιά",
  "letter:ζ": "ζήτα, ζάχαρη",
  "letter:η": "ήτα, ήλιος",
  "letter:θ": "θήτα, θάλασσα",
  "letter:ι": "γιώτα, Ιταλία",
  "letter:κ": "κάπα, καφές",
  "letter:λ": "λάμδα, λεμόνι",
  "letter:μ": "μι, μήλο",
  "letter:ν": "νι, νερό",
  "letter:ξ": "ξι, ξενοδοχείο",
  "letter:ο": "όμικρον, όνομα",
  "letter:π": "πι, πόρτα",
  "letter:ρ": "ρο, ρολόι",
  "letter:σ": "σίγμα, σπίτι",
  "letter:τ": "ταυ, ταξί",
  "letter:υ": "ύψιλον, ύπνος",
  "letter:φ": "φι, φως",
  "letter:χ": "χι, χέρι",
  "letter:ψ": "ψι, ψωμί",
  "letter:ω": "ωμέγα, ώρα",
  "letter:ου": "ούζο",
  "letter:αι": "και",
  "letter:ει": "είναι",
  "letter:μπ": "μπύρα",
  "letter:ντ": "ντομάτα",
  "letter:γκ": "γκαράζ",
  "letter:αυ": "αύριο",
  "letter:τσ": "τσάι",
  "letter:οι": "οικογένεια",
  "letter:ευ": "ευχαριστώ",
  "letter:γγ": "Αγγλία",
  "letter:τζ": "τζάκι",
};

export interface Speakable {
  lang: Lang;
  type: "word" | "chunk" | "grammar";
  key: string;
  pos?: string;
  gender?: Gender;
  domains?: string[];
}

/**
 * The text a card says: a noun with its article (η έξοδος, la boulangerie), since
 * gender is heard as much as seen; a sign as its lowercase word, since voices
 * spell capitals out letter by letter; a letter as its name and example. Grammar
 * atoms say nothing.
 */
export function spokenText(a: Speakable): string | undefined {
  if (a.type === "grammar") return undefined;
  if (a.pos === "LETTER") return LETTER_SAY[a.key];
  const key = a.key.trim();
  if (!key) return undefined;
  if (a.domains?.includes("signs")) return key;
  if (a.type === "word" && a.pos === "NOUN" && a.gender) return `${LANG_SPECS[a.lang].article(key, a.gender)}${key}`;
  return key;
}

export interface DialogueLine {
  text: string;
  voice: VoiceIndex;
}

/**
 * Dialogue as spoken lines. Lines that open with a dash are turns and alternate
 * the two voices, so a café has a waiter and a customer; anything else (a scene
 * note) takes the first voice. The dash itself isn't read.
 */
export function dialogueLines(text: string): DialogueLine[] {
  const out: DialogueLine[] = [];
  let turn = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^[—–-]\s*(.*)$/.exec(line);
    if (m) {
      if (m[1]) out.push({ text: m[1], voice: (turn % 2) as VoiceIndex });
      turn++;
    } else {
      out.push({ text: line, voice: 0 });
    }
  }
  return out;
}

/** Same text, same clip: whitespace collapsed, ends trimmed. */
export function normalizeSpeech(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The route a clip is fetched from; the browser follows its redirect to the stored audio. */
export function speechPath(lang: Lang, text: string, voice: VoiceIndex = 0, rate: SpeechRate = "normal"): string {
  const q = new URLSearchParams({ lang, text: normalizeSpeech(text) });
  if (voice) q.set("voice", String(voice));
  if (rate === "slow") q.set("rate", "slow");
  return `/api/speech?${q}`;
}
