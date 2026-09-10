import type { Modality, ModalityStat } from "@/lib/atoms/types";

/** Easiest → hardest. Used to decide whether a fail says "forgotten" or "weaker skill". */
export const MODALITY_ORDER: readonly Modality[] = ["recognize", "listen", "recall", "cloze", "produce"];

/** Rough seconds per item, for fitting a session to a time budget. */
export const MODALITY_SECONDS: Record<Modality, number> = {
  recognize: 6,
  listen: 10,
  recall: 15,
  cloze: 20,
  produce: 40,
};

export function hardness(m: Modality): number {
  return MODALITY_ORDER.indexOf(m);
}

/** The hardest modality the learner has ever answered correctly, if any. */
export function bestEstablished(stats: Record<Modality, ModalityStat>): Modality | undefined {
  let best: Modality | undefined;
  for (const m of MODALITY_ORDER) {
    if (stats[m]?.correct > 0) best = m;
  }
  return best;
}
