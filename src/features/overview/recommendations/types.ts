// Recommendation registry — the shared contract every provider implements.
//
// A Recommendation is the *action* to surface; it is derived exclusively from a
// feature's Evaluation (never from raw data). Overview's System card shows the
// single highest-priority Recommendation across all providers, so adding a new
// provider (Training / Weight / Recovery) never requires an Overview change —
// only a new file here plus one entry in PROVIDERS.

import type { NutritionEvaluation, NutritionDiagnostics } from "@features/nutrition/evaluation";
import type { RecoveryEvaluation } from "@features/health/math";
import type { TrainingEvaluation } from "@features/overview/strength";
import type { LeanMassEvaluation, GoalStatusEvaluation } from "@features/overview/goal";
import type { PhaseTriggerResult } from "@features/overview/phaseTriggers";

export type RecSource = "nutrition" | "training" | "weight" | "recovery" | "phase";

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
  recovery?: RecoveryEvaluation | null;
  training?: TrainingEvaluation | null;
  leanMass?: LeanMassEvaluation | null;
  /** Plateau-signal evaluation (what IS firing) — the engine owns the policy
   *  of when the count warrants a maintenance directive. */
  phase?: PhaseTriggerResult | null;
  /** "Is the cut's body-fat endpoint reached?" — from goal.ts, not a trigger. */
  goal?: GoalStatusEvaluation | null;
}

export type RecProvider = (ctx: RecContext) => Recommendation | null;
