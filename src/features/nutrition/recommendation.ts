// Nutrition decision — turns an Evaluation into the action to take.
//
// One pure function drives every surface that shows the recommendation:
//   - the Overview System card (eventType + actionLine),
//   - the Nutrition Insight card (actionHeadline + currentTarget + reason),
//   - the cross-provider Recommendation (built in overview/recommendations).
// Keeping it here (nutrition owns its business logic) means those surfaces can
// never disagree. Stability is structural: a real calorie change is proposed
// only at HIGH confidence, so a smooth 21-day trend keeps the decision put.

import type { NutritionEvaluation, NutritionDiagnostics } from "./evaluation";

export type NutritionAction = "maintain" | "reduce" | "increase";

export interface NutritionDecision {
  action: NutritionAction;
  /** System card line 1 — the event *type*, consistent across providers. */
  eventType: string;
  /** System card line 2 — the specific action. */
  actionLine: string;
  /** Insight card headline. */
  actionHeadline: string;
  /** Insight card reason sentence. */
  reason: string;
  currentTarget: number;
  /** The target we'd move to, or null when maintaining. */
  proposedTarget: number | null;
  priority: number;
}

const CUT_STEP = 100;
const RAISE_STEP = 150;
const kcal = (n: number) => `${n.toLocaleString()} kcal`;

function maintain(
  target: number,
  reason: string,
  priority: number,
  actionLine: string,
): NutritionDecision {
  return {
    action: "maintain",
    eventType: "Nutrition on track",
    actionLine,
    actionHeadline: "Maintain current target",
    reason,
    currentTarget: target,
    proposedTarget: null,
    priority,
  };
}

export function nutritionDecision(
  evaluation: NutritionEvaluation,
  diagnostics: NutritionDiagnostics,
): NutritionDecision {
  const target = diagnostics.calorieTarget;

  // Low confidence → never propose a change; hold and keep observing.
  if (evaluation.confidence === "low") {
    return maintain(
      target,
      "Not enough confident data yet — keep the current target while the trend settles.",
      40,
      `Maintain ${kcal(target)} — still gathering data.`,
    );
  }

  if (evaluation.status === "on_target") {
    return maintain(
      target,
      "Weight loss is tracking within the planned range.",
      30,
      `Maintain ${kcal(target)} — loss is on plan.`,
    );
  }

  const tooSlow = evaluation.status === "below_target";

  // Medium confidence on a below/above signal → hold; the trend isn't settled
  // enough to justify moving the target.
  if (evaluation.confidence !== "high") {
    return maintain(
      target,
      tooSlow
        ? "Weight loss appears slower than planned, but confidence is not yet high enough to justify changing your calorie target."
        : "Weight loss appears faster than planned, but confidence is not yet high enough to justify changing your calorie target.",
      55,
      `Hold ${kcal(target)} — trend still forming.`,
    );
  }

  // High confidence → propose an actual adjustment.
  if (tooSlow) {
    const proposed = Math.max(0, target - CUT_STEP);
    return {
      action: "reduce",
      eventType: "Nutrition adjustment recommended",
      actionLine: `Reduce target to ${kcal(proposed)}.`,
      actionHeadline: "Reduce calorie target",
      reason: "Weight loss has been slower than planned — a small cut should restart it.",
      currentTarget: target,
      proposedTarget: proposed,
      priority: 72,
    };
  }
  const proposed = target + RAISE_STEP;
  return {
    action: "increase",
    eventType: "Nutrition adjustment recommended",
    actionLine: `Increase target to ${kcal(proposed)}.`,
    actionHeadline: "Increase calorie target",
    reason: "You're losing faster than planned — ease the deficit to protect muscle.",
    currentTarget: target,
    proposedTarget: proposed,
    priority: 70,
  };
}

/** One-word pace read for the Overview Weight card (the status question). */
export function paceLabel(evaluation: NutritionEvaluation): string {
  if (evaluation.confidence === "low") return "Calibrating";
  if (evaluation.status === "on_target") return "On pace";
  return evaluation.status === "below_target" ? "Below pace" : "Above pace";
}
