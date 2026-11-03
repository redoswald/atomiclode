"use client";

import { useEffect, useRef, useState } from "react";
import { playSpeech, stopSpeech, useCanSpeak, useSpeechSettings } from "@/app/components/speech";
import type { Lang } from "@/lib/lang";
import { dialogueLines } from "@/lib/speech/say";

/** "Play dialogue": every line in turn, the two voices taking the two parts (SPEC §15). */
export function DialoguePlayer({ lang, text }: { lang: Lang; text: string }) {
  const { cloud } = useSpeechSettings();
  const canSpeak = useCanSpeak(lang);
  const [line, setLine] = useState<number | null>(null);
  const run = useRef(0);
  const lines = dialogueLines(text);

  useEffect(() => () => stopSpeech(), []);
  if (!canSpeak || lines.length === 0) return null;

  async function play() {
    const me = ++run.current;
    for (let i = 0; i < lines.length; i++) {
      if (run.current !== me) return;
      setLine(i);
      await playSpeech(cloud, lang, lines[i].text, { voice: lines[i].voice });
      await new Promise((r) => setTimeout(r, 350));
    }
    if (run.current === me) setLine(null);
  }

  function stop() {
    run.current++;
    stopSpeech();
    setLine(null);
  }

  const playing = line !== null;
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      <button type="button" onClick={playing ? stop : play} className="btn-secondary inline-flex items-center gap-2">
        {playing ? "Stop" : "Play dialogue"}
      </button>
      {playing && (
        <span className="min-w-0 truncate text-muted" lang={lang}>
          {line + 1}/{lines.length} · {lines[line].text}
        </span>
      )}
    </div>
  );
}
