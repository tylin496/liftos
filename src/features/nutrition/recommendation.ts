// Nutrition decision — turns an Evaluation into the action to take.
//
// One pure function drives every surface that shows the recommendation:
//   - the Overview System card (eventType = decision, actionLine = reason),
//   - the Nutrition Insight card (actionHeadline + currentTarget + reason),
//   - the cross-provider Recommendation (built in overview/recommendations).
// Keeping it here (nutrition owns its business logic) means those surfaces can
// never disagree. Stability is structural: a real calorie change is proposed
// only at HIGH confidence, so a smooth 21-day trend keeps the decision put.

import type { NutritionEvaluation, NutritionDiagnostics } from "./evaluation";

export type NutritionAction = "maintain" | "reduce" | "increase";

export interface NutritionDecision {
  action: NutritionAction;
  /** System card line 1 — the *decision*: "No action needed." when nothing is
   *  required, an imperative ("Review calorie target.") when it is. A command
   *  center answers "do I need to do something?", not "is my strategy working?" */
  eventType: string;
  /** System card line 2 — the *reason* for that decision. Carries no number;
   *  the calorie target lives on the Nutrition card, never duplicated here. */
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

function maintain(
  target: number,
  reason: string,
  priority: number,
  actionLine: string,
): NutritionDecision {
  return {
    action: "maintain",
    eventType: "No action needed.",
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

  // Low confidence → never propose a change; hold and keep observing. Two very
  // different causes land here, so the wording splits them: a Maintenance/Cruise
  // phase has no evaluation band at all (nothing to judge — signalled by an empty
  // target range), vs. a real cut that simply lacks enough clean data yet. Same
  // action ("No action needed."), different reason.
  if (evaluation.confidence === "low") {
    const noActiveTarget = evaluation.targetRange.min === evaluation.targetRange.max;
    if (noActiveTarget) {
      return maintain(
        target,
        "This phase isn't a tracked cut, so there's no weight-loss target to evaluate.",
        40,
        "No active weight-loss target in this phase.",
      );
    }
    return maintain(
      target,
      "Not enough confident data yet — keep the current target while the trend settles.",
      40,
      "Still gathering data on your trend.",
    );
  }

  if (evaluation.status === "on_target") {
    return maintain(
      target,
      "Weight loss is tracking within the planned range.",
      30,
      "Weight loss remains on plan.",
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
      tooSlow
        ? "Loss looks slow, but the trend isn't confirmed yet."
        : "Loss looks fast, but the trend isn't confirmed yet.",
    );
  }

  // High confidence → propose an actual adjustment.
  if (tooSlow) {
    const proposed = Math.max(0, target - CUT_STEP);
    return {
      action: "reduce",
      eventType: "Review calorie target.",
      actionLine: "Weight loss has slowed.",
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
    eventType: "Review calorie target.",
    actionLine: "You're losing faster than planned.",
    actionHeadline: "Increase calorie target",
    reason: "You're losing faster than planned — ease the deficit to protect muscle.",
    currentTarget: target,
    proposedTarget: proposed,
    priority: 70,
  };
}

/** One-word pace read for the Overview Weight card (the status question). Kept
 *  in lock-step with nutritionDecision so the Weight card never contradicts the
 *  System card: it only asserts a definitive Below/Above pace once the engine is
 *  confident enough to act on it. Below that it reads as not-yet-conclusive
 *  ("Forming"), and an untracked phase reads as "Not tracked" — never a hard
 *  pace verdict the command center is meanwhile calling "No action needed." */
export function paceLabel(evaluation: NutritionEvaluation): string {
  const noActiveTarget = evaluation.targetRange.min === evaluation.targetRange.max;
  if (noActiveTarget) return "Not tracked";
  if (evaluation.confidence === "low") return "Calibrating";
  if (evaluation.status === "on_target") return "On pace";
  if (evaluation.confidence !== "high") return "Forming";
  return evaluation.status === "below_target" ? "Below pace" : "Above pace";
}
