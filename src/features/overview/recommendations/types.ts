// Recommendation registry — the shared contract every provider implements.
//
// A Recommendation is the *action* to surface; it is derived exclusively from a
// feature's Evaluation (never from raw data). Overview's System card shows the
// single Recommendation the Decision Engine's ladder returns (see engine.ts).
//
// Two ways a directive reaches that ladder:
//   • A standalone provider (nutrition, recovery) — its own file + one PROVIDERS
//     entry; the engine calls it for the single-domain rungs and the default.
//   • A cross-domain rung written directly in the ladder (weight / phase /
//     training sources) — a *joint* verdict ("stalled AND adherent", "at goal")
//     that no single provider can express, so it lives in engine.ts, not here.
// RecSource lists every source the card may show; only the first kind appears in
// PROVIDERS.

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
  /** When true, the user may dismiss this directive because they already know
   *  its cause and the app can't (currently only a *systemic* recovery dip —
   *  low readiness with little recent training, i.e. sickness/travel). A dismiss
   *  snoozes it until training resumes (see recomputeAndPersist). Absent/false
   *  everywhere else — the app knows those causes better than any excuse. */
  dismissible?: boolean;
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
  /** The user dismissed the recovery directive (they know the cause — sick/
   *  travel — and the app can't). Suppresses the recovery rung until it auto-
   *  clears on returning to training. Resolved in the recompute, not here. */
  recoveryDismissed?: boolean;
}

export type RecProvider = (ctx: RecContext) => Recommendation | null;
