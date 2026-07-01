// Recommendation registry — collect providers, keep the highest-priority one.
//
// Only the Nutrition provider is populated today. Adding Training / Weight /
// Recovery later means: write the provider, add its Evaluation slice to
// RecContext, and append it here. Overview and every existing UI stay untouched.

import type { RecContext, Recommendation, RecProvider } from "./types";
import { nutritionProvider } from "./nutrition";

export const PROVIDERS: RecProvider[] = [nutritionProvider];

/** All non-null recommendations, most urgent first. */
export function deriveRecommendations(ctx: RecContext): Recommendation[] {
  return PROVIDERS.map((p) => p(ctx))
    .filter((r): r is Recommendation => r != null)
    .sort((a, b) => b.priority - a.priority);
}

/** The single recommendation the System card surfaces. */
export function topRecommendation(ctx: RecContext): Recommendation | null {
  return deriveRecommendations(ctx)[0] ?? null;
}

export type { Recommendation, RecSource, RecContext, RecProvider } from "./types";
