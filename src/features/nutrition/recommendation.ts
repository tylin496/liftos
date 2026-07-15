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
import { MIN_TREND_POINTS, STATUS_EPS } from "./evaluation";

type NutritionAction = "maintain" | "reduce" | "increase";

export interface NutritionDecision {
  action: NutritionAction;
  /** System card line 1 — the *decision*: "No action needed" when nothing is
   *  required, an imperative ("Review calorie target") when it is. A command
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
    eventType: "No action needed",
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
  // action ("No action needed"), different reason.
  if (evaluation.confidence === "low") {
    const noActiveTarget = evaluation.targetRange.min === evaluation.targetRange.max;
    if (noActiveTarget) {
      return maintain(
        target,
        "This phase isn't a tracked cut, so there's no weight-loss target to evaluate.",
        40,
        "No active weight-loss target in this phase",
      );
    }
    return maintain(
      target,
      "Not enough confident data yet — keep the current target while the trend settles.",
      40,
      "Still gathering data on your trend",
    );
  }

  if (evaluation.status === "on_target") {
    return maintain(
      target,
      "Weight loss is tracking within the planned range.",
      30,
      "Weight loss remains on plan",
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
        ? "Loss looks slow, but the trend isn't confirmed yet"
        : "Loss looks fast, but the trend isn't confirmed yet",
    );
  }

  // High confidence → propose an actual adjustment.
  if (tooSlow) {
    const proposed = Math.max(0, target - CUT_STEP);
    return {
      action: "reduce",
      eventType: "Review calorie target",
      actionLine: "Weight loss has slowed",
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
    eventType: "Review calorie target",
    actionLine: "You're losing faster than planned",
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
 *  pace verdict the command center is meanwhile calling "No action needed" */
export function paceLabel(evaluation: NutritionEvaluation): string {
  const noActiveTarget = evaluation.targetRange.min === evaluation.targetRange.max;
  if (noActiveTarget) return "Not tracked";
  if (evaluation.confidence === "low") return "Calibrating";
  if (evaluation.status === "on_target") return isOptimalPace(evaluation) ? "Optimal" : "On pace";
  if (evaluation.confidence !== "high") return "Forming";
  // Losing too fast is "Too fast", not "Above pace": on a cut it's a muscle risk
  // the Decision Engine wants corrected, not a lead to celebrate.
  return evaluation.status === "below_target" ? "Below pace" : "Too fast";
}

/** Top slice of the target band, in-range loss rates close to `max` count as
 *  "optimal" — losing as fast as the plan safely allows, not just "in band
 *  somewhere". Fraction of the band width, not a fixed kg margin, so a wide
 *  band (aggressive cut) and a narrow one (gentle cut) both reserve the same
 *  proportional top slice. */
const OPTIMAL_BAND_FRACTION = 0.2;

/** Is the observed loss rate on-target AND sitting in the top slice of the
 *  band (closest to the safe max)? Shared by paceLabel/paceTone (the Pace
 *  word) and rateTone (the Rate number) so both surfaces flip to gold
 *  together — never one alone. No band (not tracked) → never optimal. */
function isOptimalPace(evaluation: Pick<NutritionEvaluation, "status" | "observedRate" | "targetRange">): boolean {
  if (evaluation.status !== "on_target") return false;
  const { min, max } = evaluation.targetRange;
  if (min === max) return false;
  const loss = -evaluation.observedRate;
  const threshold = max - (max - min) * OPTIMAL_BAND_FRACTION;
  return loss >= threshold;
}

export type PaceTone = "good" | "warn" | "bad" | "gold" | null;

/** Severity colour for the pace status word (COLOR-SYSTEM rule 3: status words
 *  carry severity colour whether badge or plain text). Only *on pace* is good;
 *  outside the band either way (too fast OR too slow) is a caution; actually
 *  gaining weight during a cut is bad. This mirrors the Decision Engine — losing
 *  too fast is a muscle risk it corrects, not a lead — so the pace pill and the
 *  System card can never disagree. Inconclusive/untracked reads (Calibrating /
 *  Forming / Not tracked) stay neutral. Kept beside paceLabel so word and colour
 *  never diverge. */
export function paceTone(evaluation: NutritionEvaluation): PaceTone {
  const noActiveTarget = evaluation.targetRange.min === evaluation.targetRange.max;
  if (noActiveTarget) return null;                    // Not tracked
  if (evaluation.confidence === "low") return null;   // Calibrating
  if (evaluation.status === "on_target") return isOptimalPace(evaluation) ? "gold" : "good"; // On pace
  if (evaluation.confidence !== "high") return null;  // Forming — not conclusive
  // Outside the band, either direction, is a caution — too fast (loss > band) is
  // a muscle risk, too slow (loss < band) is stalled progress. Only outright
  // gaining weight during the cut (observedRate > 0) is the worst read.
  return evaluation.observedRate > 0 ? "bad" : "warn";
}

export type RateTone = "good" | "warn" | "bad" | "gold" | null;

/** kg/week beyond a target-band edge before a rate reads as materially off
 *  rather than just outside-but-close. */
const RATE_NEAR_MARGIN = 0.15;

/** Severity colour for the observed-rate *number* itself — how far it sits
 *  from the target band, independent of confidence or direction framing.
 *  Unlike paceTone (the pace verdict word), which folds in confidence-gating
 *  and reads "above pace" as unconditionally good, the raw rate is a
 *  magnitude: both too slow and too fast score worse the further they drift
 *  from the band, so this is not monotonic in the rate's sign. Good = inside
 *  the band; warn = within RATE_NEAR_MARGIN of an edge; bad = further out
 *  than that. No active target → neutral, nothing to compare against. */
export function rateTone(
  evaluation: Pick<NutritionEvaluation, "observedRate" | "targetRange">,
): RateTone {
  const { observedRate, targetRange } = evaluation;
  const { min, max } = targetRange;
  if (min === max) return null; // Not tracked
  const loss = -observedRate;
  // Match evaluate()'s STATUS_EPS deadband on BOTH edges: a reading in the
  // [min−EPS, min) or (max, max+EPS] slivers is still on_target to evaluate() (so
  // paceTone reads "On pace"/good). Widening the in-band check the same way keeps
  // the rate number/dot from disagreeing with the pace word by falling through to
  // "warn" at either edge.
  if (loss >= min - STATUS_EPS && loss <= max + STATUS_EPS) {
    // Same top-slice-of-band rule as isOptimalPace (paceLabel/paceTone) — kept
    // inline rather than sharing the helper since it doesn't need `status`
    // here (already known in-band from the check above).
    const threshold = max - (max - min) * OPTIMAL_BAND_FRACTION;
    return loss >= threshold ? "gold" : "good";
  }
  const distance = loss < min ? min - loss : loss - max;
  return distance <= RATE_NEAR_MARGIN ? "warn" : "bad";
}

/** Below this weekly rate (kg/week), a remaining/rate division produces a
 *  triple-digit "weeks" number that's technically arithmetic but not a
 *  meaningful estimate — the trend is too close to flat to extrapolate. */
const MIN_RATE_FOR_ETA = 0.2;
/** Above this many weeks, show ">1 year" instead of a large, falsely precise
 *  week count. */
const ETA_CEILING_WEEKS = 52;

/** ETA readout for the Cut Progress card's "Remaining" row — "≈16 weeks left"
 *  or a guarded fallback when an estimate would just be noise. Always divides
 *  by the same 21-day observed rate `paceLabel`/`rateTone` use (never the
 *  day's raw weight delta), so it can't swing day-to-day the way a naive
 *  remainingWeight / today's-change ratio would — a single bad water-weight
 *  reading can't make the ETA jump from 15 to 22 weeks and back. Returns null
 *  when there's nothing worth showing (goal already reached/passed). */
export function cutEtaLabel(
  evaluation: Pick<NutritionEvaluation, "confidence" | "observedRate">,
  weightDataPoints: number,
  remainingWeight: number,
): string | null {
  if (remainingWeight <= 0) return null;
  if (weightDataPoints < MIN_TREND_POINTS) return "Building estimate…";
  if (evaluation.confidence === "low") return "Estimate unavailable";
  if (evaluation.observedRate >= 0) return "No estimate";
  const rate = -evaluation.observedRate;
  if (rate < MIN_RATE_FOR_ETA) return "Rate too low to estimate";
  const weeks = remainingWeight / rate;
  return weeks > ETA_CEILING_WEEKS ? ">1 year" : `≈${Math.round(weeks)} weeks`;
}
