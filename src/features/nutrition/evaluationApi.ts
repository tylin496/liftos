// Nutrition Evaluation — orchestration + persistence.
//
// This is the ONLY place the evaluation is recomputed and written. It reads raw
// data (weight, config, entries), runs the pure `evaluate()` brain, derives the
// Recommendation, and persists the single per-user state row. Every screen reads
// that row via `getNutritionState()` and never recomputes — the spec's "single
// source of truth" rule. It's a data-layer module (not a UI component), so it is
// allowed to hold this business logic.

import { supabase } from "@shared/lib/supabase";
import { isViewer } from "@shared/lib/owner";
import type { Database } from "@shared/lib/database.types";
import { localDateStrDaysAgo } from "@shared/lib/date";
import { series, buildRecoveryEvaluation } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";
import { computeTdeeWindows } from "@features/health/tdee";
import { targetsFromConfig, type NutritionConfig } from "./api";
import { DEFAULTS, phaseFromDeficit } from "./logic";
import {
  evaluate,
  type NutritionEvaluation,
  type NutritionDiagnostics,
  type EvalStatus,
  type Confidence,
} from "./evaluation";
import { topRecommendation, type Recommendation, type RecSource } from "@features/overview/recommendations";

type Row = Database["public"]["Tables"]["nutrition_evaluations"]["Row"];
type Insert = Database["public"]["Tables"]["nutrition_evaluations"]["Insert"];

/** The full persisted state as the UI consumes it. */
export interface NutritionStateFull {
  evaluation: NutritionEvaluation;
  diagnostics: NutritionDiagnostics;
  recommendation: Recommendation | null;
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Not signed in");
  return data.user.id;
}

/** Trailing consecutive days (entries are ascending) logged at `target`. */
function trailingDaysOnTarget(
  entries: { calorie_target: number | null }[],
  target: number,
): number {
  let n = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].calorie_target === target) n += 1;
    else break;
  }
  return n;
}

function rowToState(row: Row): NutritionStateFull {
  const evaluation: NutritionEvaluation = {
    status: row.status as EvalStatus,
    observedRate: row.observed_rate,
    targetRange: { min: row.target_min, max: row.target_max },
    confidence: row.confidence as Confidence,
    evaluatedAt: row.evaluated_at,
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: row.estimated_tdee ?? 0,
    estimatedIntake: row.estimated_intake ?? 0,
    intakeDifference: row.intake_difference ?? 0,
    calorieTarget: row.calorie_target ?? 0,
    cutMode: row.cut_mode ?? "",
    windowDays: row.window_days ?? 0,
    weightDataPoints: row.weight_data_points ?? 0,
    // Not persisted (debug-only input to the confidence score, whose result is
    // already stored on `confidence`); the live `evaluate` path recomputes it.
    longestGap: 0,
    daysOnTarget: row.days_on_target ?? 0,
  };
  const recommendation: Recommendation | null = row.rec_title
    ? {
        source: (row.rec_source ?? "nutrition") as RecSource,
        priority: row.rec_priority ?? 0,
        title: row.rec_title,
        subtitle: row.rec_subtitle ?? "",
      }
    : null;
  return { evaluation, diagnostics, recommendation };
}

function stateToRow(
  userId: string,
  { evaluation, diagnostics, recommendation }: NutritionStateFull,
): Insert {
  return {
    user_id: userId,
    status: evaluation.status,
    observed_rate: evaluation.observedRate,
    target_min: evaluation.targetRange.min,
    target_max: evaluation.targetRange.max,
    confidence: evaluation.confidence,
    evaluated_at: evaluation.evaluatedAt,
    estimated_tdee: diagnostics.estimatedTdee,
    estimated_intake: diagnostics.estimatedIntake,
    intake_difference: diagnostics.intakeDifference,
    calorie_target: diagnostics.calorieTarget,
    cut_mode: diagnostics.cutMode,
    window_days: diagnostics.windowDays,
    weight_data_points: diagnostics.weightDataPoints,
    days_on_target: diagnostics.daysOnTarget,
    rec_source: recommendation?.source ?? null,
    rec_priority: recommendation?.priority ?? null,
    rec_title: recommendation?.title ?? null,
    rec_subtitle: recommendation?.subtitle ?? null,
  };
}

/** Plain read of the persisted state (RLS scopes it to the current user).
 *  Returns null before the first evaluation has ever been computed. */
export async function getNutritionState(): Promise<NutritionStateFull | null> {
  // Degrade gracefully: before the 0006 migration is applied (or if the read
  // fails for any reason) return null so consumers show their empty state rather
  // than breaking the whole page. This read never rejects.
  try {
    const { data, error } = await supabase
      .from("nutrition_evaluations")
      .select("*")
      .maybeSingle();
    if (error) return null;
    return data ? rowToState(data as Row) : null;
  } catch {
    return null;
  }
}

/** Recompute the evaluation from current data and persist it. Call this when new
 *  data lands (entry saved/deleted, weight synced), fire-and-forget — never from
 *  render. Returns the fresh state so callers can refresh immediately if they
 *  awaited it. */
export async function recomputeAndPersist(): Promise<NutritionStateFull> {
  const userId = await currentUserId();

  const [metricsRes, configRes, entriesRes] = await Promise.all([
    supabase
      .from("health_metrics")
      .select("metric_date, weight_kg, active_energy_kcal, resting_energy_kcal, exercise_minutes, sleep_seconds, resting_heart_rate, hrv_sdnn_ms")
      .gte("metric_date", localDateStrDaysAgo(90))
      .order("metric_date", { ascending: true }),
    supabase.from("nutrition_config").select("*").maybeSingle(),
    supabase
      .from("nutrition_entries")
      .select("entry_date, calorie_target")
      .gte("entry_date", localDateStrDaysAgo(60))
      .order("entry_date", { ascending: true }),
  ]);

  // Abort on a failed read rather than recomputing from silently-empty data —
  // that would persist a wrong evaluation over the last good one. Callers are
  // fire-and-forget, so throwing here simply skips this recompute.
  if (metricsRes.error) throw metricsRes.error;
  if (configRes.error) throw configRes.error;
  if (entriesRes.error) throw entriesRes.error;

  const metrics = (metricsRes.data ?? []) as BodyMetric[];
  const config = (configRes.data as NutritionConfig | null) ?? null;
  const entries = entriesRes.data ?? [];

  const targets = config ? targetsFromConfig(config) : null;
  const calorieTarget = targets?.calorieTarget ?? DEFAULTS.tdee - DEFAULTS.deficitTarget;
  const cutMode = targets?.cutPhaseName ?? phaseFromDeficit(DEFAULTS.deficitTarget);

  const { tdee } = computeTdeeWindows(metrics);
  const estimatedTdee = tdee.tdee ?? targets?.tdee ?? DEFAULTS.tdee;

  const weightSeries = series(metrics, "weight_kg");
  const daysOnTarget = trailingDaysOnTarget(entries, calorieTarget);

  const { evaluation, diagnostics } = evaluate({
    weightSeries,
    cutMode,
    calorieTarget,
    estimatedTdee,
    daysOnTarget,
    now: new Date(),
  });

  // Recommendation is derived from the Evaluations — the single source of truth.
  // This assembler is the one place that already holds the raw health metrics, so
  // it also builds the recovery slice; the registry arbitrates across providers.
  const recovery = buildRecoveryEvaluation(metrics);
  const recommendation = topRecommendation({ nutrition: { evaluation, diagnostics }, recovery });
  const state: NutritionStateFull = { evaluation, diagnostics, recommendation };

  // A shared viewer computes from the owner's data (RLS) but must not persist —
  // the row belongs to the owner and the write would be rejected anyway.
  if (await isViewer()) return state;

  const { error } = await supabase
    .from("nutrition_evaluations")
    .upsert(stateToRow(userId, state), { onConflict: "user_id" });
  if (error) throw error;

  return state;
}
