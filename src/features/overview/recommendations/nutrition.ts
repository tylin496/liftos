// Nutrition recommendation provider — the decision engine.
//
// Derives the action purely from the Evaluation (status + confidence). Stability
// is structural, not time-based: the observed rate is a smooth 21-day trend, and
// an actual calorie change is only proposed at HIGH confidence. Medium confidence
// holds the current target ("give it a few more days"), so the recommendation
// stays put until the evaluation genuinely warrants a change.

import type { RecProvider } from "./types";

// Step sizes for a proposed adjustment. Asymmetric on purpose: nudge intake down
// gently when loss stalls, but back off harder when losing too fast (protect
// muscle on a cut). intakeDifference is diagnostic and deliberately unused here.
const CUT_STEP = 100;
const RAISE_STEP = 150;

export const nutritionProvider: RecProvider = (ctx) => {
  const state = ctx.nutrition;
  if (!state) return null;

  const { evaluation, diagnostics } = state;
  const target = diagnostics.calorieTarget;
  const kcal = target.toLocaleString();

  // Low confidence → never propose a change; hold and keep observing.
  if (evaluation.confidence === "low") {
    return {
      source: "nutrition",
      priority: 40,
      title: `Maintain ${kcal} kcal`,
      subtitle: "Still gathering data — keep the current target while the trend settles.",
    };
  }

  if (evaluation.status === "on_target") {
    return {
      source: "nutrition",
      priority: 30,
      title: `Maintain ${kcal} kcal`,
      subtitle: "Weight loss is tracking within the planned range.",
    };
  }

  if (evaluation.status === "below_target") {
    if (evaluation.confidence === "high") {
      const next = Math.max(0, target - CUT_STEP).toLocaleString();
      return {
        source: "nutrition",
        priority: 72,
        title: `Reduce target to ${next} kcal`,
        subtitle: "Loss has been slower than planned — a small cut should restart it.",
      };
    }
    return {
      source: "nutrition",
      priority: 55,
      title: `Hold ${kcal} kcal`,
      subtitle: "Loss looks slow — give the trend a few more days to confirm.",
    };
  }

  // above_target — losing faster than planned.
  if (evaluation.confidence === "high") {
    const next = (target + RAISE_STEP).toLocaleString();
    return {
      source: "nutrition",
      priority: 70,
      title: `Increase target to ${next} kcal`,
      subtitle: "You're losing faster than planned — ease the deficit to protect muscle.",
    };
  }
  return {
    source: "nutrition",
    priority: 55,
    title: `Hold ${kcal} kcal`,
    subtitle: "Loss looks fast — give the trend a few more days to confirm.",
  };
};
