// Recommendation registry — the shared contract every provider implements.
//
// A Recommendation is the *action* to surface; it is derived exclusively from a
// feature's Evaluation (never from raw data). Overview's System card shows the
// single highest-priority Recommendation across all providers, so adding a new
// provider (Training / Weight / Recovery) never requires an Overview change —
// only a new file here plus one entry in PROVIDERS.

import type { NutritionEvaluation, NutritionDiagnostics } from "@features/nutrition/evaluation";

export type RecSource = "nutrition" | "training" | "weight" | "recovery";

export interface Recommendation {
  source: RecSource;
  /** Higher = more urgent. Sorted descending for the System card. */
  priority: number;
  title: string;
  subtitle: string;
}

/** Everything a provider may read to derive its Recommendation. Each feature's
 *  Evaluation is optional so providers stay independent — a provider returns
 *  null when it has no input yet. Future providers add their own slice here. */
export interface RecContext {
  nutrition?: { evaluation: NutritionEvaluation; diagnostics: NutritionDiagnostics } | null;
}

export type RecProvider = (ctx: RecContext) => Recommendation | null;
