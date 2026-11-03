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
 * A letter is heard through words, never alone: a voice reads a bare letter by
 * its name (ο comes out "omikron") or not at all (α, ι, αι come back silent).
 * So each letter plays two everyday words that start with its sound (SPEC §17:
 * sounds are taught inside words). The name stays in the card's written gloss.
 * The words avoid Unit 1's own items, so "which word has this sound" never
 * plays one of its answers. Keys match the letter atoms (`letter:α`).
 */
export const LETTER_SAY: Record<string, string> = {
  "letter:α": "άλλο, αέρας",
  "letter:β": "βάρκα, βουνό",
  "letter:γ": "γάτα, γωνία",
  "letter:δ": "δρόμος, δώρο",
  "letter:ε": "ελιά, εδώ",
  "letter:ζ": "ζάχαρη, ζεστό",
  "letter:η": "ήλιος, ήδη",
  "letter:θ": "θάλασσα, θέατρο",
  "letter:ι": "ίδιο, Ιταλία",
  "letter:κ": "κάτω, κόσμος",
  "letter:λ": "λάθος, λίγο",
  "letter:μ": "μήλο, μαζί",
  "letter:ν": "νύχτα, νησί",
  "letter:ξ": "ξύλο, ξενοδοχείο",
  "letter:ο": "όνομα, όλα",
  "letter:π": "πόρτα, πάνω",
  "letter:ρ": "ρολόι, ρύζι",
  "letter:σ": "σπίτι, σήμερα",
  "letter:τ": "τώρα, τέλος",
  "letter:υ": "ύπνος, ύψος",
  "letter:φ": "φως, φίλος",
  "letter:χ": "χέρι, χαρτί",
  "letter:ψ": "ψωμί, ψάρι",
  "letter:ω": "ώρα, ωραίο",
  "letter:ου": "ούζο, ουρά",
  "letter:αι": "αίμα, αίθουσα",
  "letter:ει": "είκοσι, εικόνα",
  "letter:μπ": "μπάλα, μπλε",
  "letter:ντ": "ντους, ντουλάπα",
  "letter:γκ": "γκαράζ, γκρι",
  "letter:αυ": "αύριο, αυγό",
  "letter:τσ": "τσάντα, τσέπη",
  "letter:οι": "οικογένεια, οίκος",
  "letter:ευ": "Ευρώπη, ευχή",
  "letter:γγ": "Αγγλία, φεγγάρι",
  "letter:τζ": "τζάκι, τζάμι",
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
