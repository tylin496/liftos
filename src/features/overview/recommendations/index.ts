// Recommendation registry.
//
// `topRecommendation` — what the System card surfaces — is the Decision Engine's
// verdict: a precedence LADDER over every domain's Evaluation (see engine.ts),
// NOT the max of independent per-domain priorities.
//
// `deriveRecommendations` is kept as the raw, unranked per-provider view (each
// domain's own take) for tests and diagnostics. It is intentionally NOT what the
// UI shows — a joint verdict like "losing too fast AND training's slipping" only
// exists in the ladder, never in any single provider.

import type { RecContext, Recommendation, RecProvider } from "./types";
import { nutritionProvider } from "./nutrition";
import { recoveryProvider } from "./recovery";
import { decide } from "./engine";

export const PROVIDERS: RecProvider[] = [nutritionProvider, recoveryProvider];

/** Raw per-provider opinions, most urgent first — diagnostics/tests only. */
export function deriveRecommendations(ctx: RecContext): Recommendation[] {
  return PROVIDERS.map((p) => p(ctx))
    .filter((r): r is Recommendation => r != null)
    .sort((a, b) => b.priority - a.priority);
}

/** The single recommendation the System card surfaces — the Decision Engine's
 *  ladder verdict (Protect > Correct > Sustain > Capitalize). `prior` is the
 *  last-surfaced recommendation (persisted); pass it so exit-hysteresis can hold
 *  a directive through a marginal wobble instead of flip-flopping. */
export function topRecommendation(
  ctx: RecContext,
  prior?: Recommendation | null,
): Recommendation | null {
  return decide(ctx, prior);
}

export { decide, CONSIDER_ENTER_COUNT } from "./engine";
export type { Recommendation, RecSource, RecContext, RecProvider } from "./types";
