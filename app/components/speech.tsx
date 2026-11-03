"use client";

/**
 * Sound in the browser (SPEC §15). One player for the whole app, so a new clip
 * stops the last one. Clips come from /api/speech when a provider is configured;
 * otherwise the browser's own voice is used where it has one for the language.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Lang } from "@/lib/lang";
import { LANG_SPECS } from "@/lib/lang";
import { normalizeSpeech, speechPath, type SpeechRate, type VoiceIndex } from "@/lib/speech/say";

const AUTOPLAY_KEY = "dolomite-autoplay";
/** A second tap on the same thing within this long plays it slowly. */
const SLOW_TAP_MS = 2000;

interface SpeechState {
  /** Clips from the server (true) or the browser's voice (false). */
  cloud: boolean;
  autoplay: boolean;
  setAutoplay: (on: boolean) => void;
}

const SpeechContext = createContext<SpeechState>({ cloud: false, autoplay: false, setAutoplay: () => {} });

export function SpeechProvider({ cloud, children }: { cloud: boolean; children: React.ReactNode }) {
  const [autoplay, setAutoplayState] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(AUTOPLAY_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a per-device setting after hydration
      if (v !== null) setAutoplayState(v === "1");
    } catch {}
  }, []);
  const setAutoplay = useCallback((on: boolean) => {
    setAutoplayState(on);
    try {
      localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
    } catch {}
  }, []);
  return <SpeechContext.Provider value={{ cloud, autoplay, setAutoplay }}>{children}</SpeechContext.Provider>;
}

export function useSpeechSettings(): SpeechState {
  return useContext(SpeechContext);
}

// ---- the one player ------------------------------------------------------------

let audio: HTMLAudioElement | null = null;
let onStop: (() => void) | null = null;
let last: { id: string; at: number } | null = null;

export function stopSpeech(): void {
  audio?.pause();
  audio = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  const cb = onStop;
  onStop = null;
  cb?.();
}

function browserVoiceFor(lang: Lang): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === "undefined") return undefined;
  const code = LANG_SPECS[lang].speech.languageCode.toLowerCase();
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase() === code) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang));
}

export interface PlayOptions {
  voice?: VoiceIndex;
  rate?: SpeechRate;
  /** Called when this clip ends, fails, or is cut off by another. */
  onEnd?: () => void;
}

/** Play now, cutting off whatever is playing. Resolves when it ends. */
export function playSpeech(cloud: boolean, lang: Lang, text: string, opts: PlayOptions = {}): Promise<void> {
  stopSpeech();
  const said = normalizeSpeech(text);
  if (!said) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (onStop === done) onStop = null;
      opts.onEnd?.();
      resolve();
    };
    onStop = done;
    if (cloud) {
      const a = new Audio(speechPath(lang, said, opts.voice ?? 0, opts.rate ?? "normal"));
      audio = a;
      a.addEventListener("ended", () => audio === a && stopSpeech());
      a.addEventListener("error", () => audio === a && stopSpeech());
      a.play().catch(() => audio === a && stopSpeech());
      return;
    }
    const voice = browserVoiceFor(lang);
    if (!voice) return stopSpeech();
    const u = new SpeechSynthesisUtterance(said);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = opts.rate === "slow" ? 0.7 : 1;
    u.onend = u.onerror = () => onStop === done && stopSpeech();
    speechSynthesis.speak(u);
  });
}

/** Ask the server to voice a clip now, so it's ready when it's played. No-op without a provider. */
export function prefetchSpeech(cloud: boolean, lang: Lang, text: string | undefined): void {
  if (!cloud || !text?.trim()) return;
  fetch(speechPath(lang, text), { credentials: "same-origin" }).catch(() => {});
}

/** Whether there is any way to speak this language here (provider, or a browser voice). */
export function useCanSpeak(lang: Lang): boolean {
  const { cloud } = useSpeechSettings();
  const [browser, setBrowser] = useState(false);
  useEffect(() => {
    if (cloud || typeof speechSynthesis === "undefined") return;
    const check = () => setBrowser(Boolean(browserVoiceFor(lang)));
    check();
    speechSynthesis.addEventListener("voiceschanged", check);
    return () => speechSynthesis.removeEventListener("voiceschanged", check);
  }, [cloud, lang]);
  return cloud || browser;
}

// ---- controls -----------------------------------------------------------------

export function SpeakButton({
  lang,
  text,
  voice = 0,
  label = "Play",
  className = "",
}: {
  lang: Lang;
  text: string | undefined;
  voice?: VoiceIndex;
  label?: string;
  className?: string;
}) {
  const { cloud } = useSpeechSettings();
  const canSpeak = useCanSpeak(lang);
  const [playing, setPlaying] = useState(false);
  if (!text || !canSpeak) return null;

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    const id = `${lang}|${voice}|${text}`;
    const now = Date.now();
    const slow = last?.id === id && now - last.at < SLOW_TAP_MS;
    last = { id, at: now };
    setPlaying(true);
    playSpeech(cloud, lang, text!, { voice, rate: slow ? "slow" : "normal", onEnd: () => setPlaying(false) });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} (tap again for slow)`}
      title="Play · tap again for slow"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink ${playing ? "border-sage bg-tint-sage" : ""} ${className}`}
    >
      <SpeakerIcon />
    </button>
  );
}

export function AutoplayToggle() {
  const { autoplay, setAutoplay } = useSpeechSettings();
  return (
    <button type="button" onClick={() => setAutoplay(!autoplay)} aria-pressed={autoplay} className="inline-flex items-center gap-1.5 text-xs text-muted">
      <SpeakerIcon muted={!autoplay} />
      {autoplay ? "Sound on" : "Sound off"}
    </button>
  );
}

function SpeakerIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}
