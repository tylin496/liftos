// Nutrition recommendation provider.
//
// Thin wrapper over the nutrition feature's own decision logic (nutrition owns
// its business logic). It shapes that decision into the generic Recommendation
// the System card consumes: title = event type (consistent across providers),
// subtitle = the specific action.

import type { RecProvider } from "./types";
import { nutritionDecision } from "@features/nutrition/recommendation";

export const nutritionProvider: RecProvider = (ctx) => {
  const state = ctx.nutrition;
  if (!state) return null;

  const d = nutritionDecision(state.evaluation, state.diagnostics);
  return {
    source: "nutrition",
    priority: d.priority,
    title: d.eventType,
    subtitle: d.actionLine,
  };
};
