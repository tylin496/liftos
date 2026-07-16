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
import { series, buildRecoveryEvaluation, sanitizeMetrics } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";
import { computeTdeeWindows } from "@features/health/tdee";
import { computeStrengthSummary, buildTrainingEvaluation } from "@features/overview/strength";
import { buildLeanMassEvaluation, buildGoalStatus } from "@features/overview/goal";
import { evaluatePhaseTriggers } from "@features/overview/phaseTriggers";
import { targetsFromConfig, type NutritionConfig } from "./api";
import { DEFAULTS, phaseFromDeficit } from "./logic";
import {
  evaluate,
  WINDOW_DAYS,
  type NutritionEvaluation,
  type NutritionDiagnostics,
  type EvalStatus,
  type Confidence,
} from "./evaluation";

/** Min logged days in the trend window before the mean logged intake is trusted
 *  enough to compare against the weight-implied intake. Below this the food-log
 *  signal is too sparse — pass null so it has no effect on confidence. */
const MIN_LOGGED_DAYS = 10;

/** Mean of the logged daily calories inside the trailing WINDOW_DAYS, or null
 *  when fewer than MIN_LOGGED_DAYS are logged. Spans the same 21-day length as the
 *  weight-trend window (WINDOW_DAYS − 1 days back → today inclusive = 21 days), so
 *  the two intakes describe the same period when the weight feed is current. (A
 *  stale weight feed anchors its window on the last reading instead of today; the
 *  resulting drift only tempers confidence, never triggers a change.) */
export function windowedLoggedIntake(
  entries: { entry_date: string; calories: number | null }[],
): number | null {
  const cutoff = localDateStrDaysAgo(WINDOW_DAYS - 1);
  const cals = entries
    .filter((e) => e.entry_date >= cutoff && e.calories != null)
    .map((e) => e.calories as number);
  if (cals.length < MIN_LOGGED_DAYS) return null;
  return cals.reduce((s, c) => s + c, 0) / cals.length;
}
import { topRecommendation, type Recommendation, type RecSource } from "@features/overview/recommendations";

type Row = Database["public"]["Tables"]["nutrition_evaluations"]["Row"];
type Insert = Database["public"]["Tables"]["nutrition_evaluations"]["Insert"];

/** The full persisted state as the UI consumes it. */
export interface NutritionStateFull {
  evaluation: NutritionEvaluation;
  diagnostics: NutritionDiagnostics;
  recommendation: Recommendation | null;
  /** Date (YYYY-MM-DD) the user dismissed a systemic recovery directive, or null.
   *  While set (and un-expired) the engine suppresses the recovery rung; the
   *  recompute auto-clears it once training resumes or after a 10-day cap. */
  recoveryDismissedAt: string | null;
}

async function currentUserId(): Promise<string> {
  // getSession reads the cached session locally; getUser revalidates over the
  // network on every call — we only need the id, which is already stored.
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw error ?? new Error("Not signed in");
  return data.session.user.id;
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
    // Nullable + tolerant of the pre-accel_direction column (older rows / before
    // the migration): an absent column reads back as undefined → null.
    accelDirection: (row.accel_direction as "faster" | "slowing" | null) ?? null,
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: row.estimated_tdee ?? 0,
    estimatedIntake: row.estimated_intake ?? 0,
    intakeDifference: row.intake_difference ?? 0,
    calorieTarget: row.calorie_target ?? 0,
    cutMode: row.cut_mode ?? "",
    windowDays: row.window_days ?? 0,
    weightDataPoints: row.weight_data_points ?? 0,
    // NOT stored as columns, so they can't round-trip: a persisted-row READER
    // always sees these stubs, never the real values `evaluate` used to set
    // `confidence`. The confidence LABEL is already stored, so the app is fine —
    // but any consumer that reprints these (the AI export) must RECOMPUTE them from
    // live data, or it prints null/null/0 beside a confidence built from the real
    // numbers (see copyAllData engineHypothesis `liveDiag`).
    longestGap: 0,
    loggedIntake: null,
    intakeGap: null,
    daysOnTarget: row.days_on_target ?? 0,
  };
  const recommendation: Recommendation | null = row.rec_title
    ? {
        source: (row.rec_source ?? "nutrition") as RecSource,
        priority: row.rec_priority ?? 0,
        title: row.rec_title,
        subtitle: row.rec_subtitle ?? "",
        // Tolerant of the pre-migration column (older rows read back undefined → false).
        dismissible: (row.rec_dismissible as boolean | null) ?? false,
      }
    : null;
  // Same tolerance: an absent column (before the migration) reads as null.
  const recoveryDismissedAt = (row.recovery_dismissed_at as string | null) ?? null;
  return { evaluation, diagnostics, recommendation, recoveryDismissedAt };
}

function stateToRow(
  userId: string,
  { evaluation, diagnostics, recommendation, recoveryDismissedAt }: NutritionStateFull,
): Insert {
  return {
    user_id: userId,
    recovery_dismissed_at: recoveryDismissedAt,
    status: evaluation.status,
    observed_rate: evaluation.observedRate,
    target_min: evaluation.targetRange.min,
    target_max: evaluation.targetRange.max,
    confidence: evaluation.confidence,
    evaluated_at: evaluation.evaluatedAt,
    accel_direction: evaluation.accelDirection,
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
    rec_dismissible: recommendation?.dismissible ?? null,
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

// A recovery dismiss can't hide a low reading forever — after this many days it
// auto-clears and the directive is free to resurface if readiness is still down.
// Sized to outlast a typical illness/trip while still catching a genuine, lasting
// dip the user should actually act on.
const RECOVERY_DISMISS_MAX_DAYS = 10;

/** Dismiss the current systemic recovery directive (owner only). The user is
 *  telling us they know why readiness is down — sickness/travel — which the app
 *  can't infer. Records today as the dismiss date, then recomputes so the
 *  suppressed recommendation persists immediately. Auto-clears on the next
 *  recompute once training resumes (or after RECOVERY_DISMISS_MAX_DAYS). */
export async function dismissRecoveryDirective(): Promise<NutritionStateFull | null> {
  if (await isViewer()) return null;
  const userId = await currentUserId();
  const { error } = await supabase
    .from("nutrition_evaluations")
    .update({ recovery_dismissed_at: localDateStrDaysAgo(0) })
    .eq("user_id", userId);
  if (error) throw error;
  return recomputeAndPersist();
}

/** Recompute the evaluation from current data and persist it. Call this when new
 *  data lands (entry saved/deleted, weight synced), fire-and-forget — never from
 *  render. Returns the fresh state so callers can refresh immediately if they
 *  awaited it. */
export async function recomputeAndPersist(): Promise<NutritionStateFull> {
  const userId = await currentUserId();

  const [metricsRes, configRes, entriesRes, logsRes, archivedRes, priorState] = await Promise.all([
    supabase
      .from("health_metrics")
      .select("metric_date, weight_kg, body_fat_pct, active_energy_kcal, resting_energy_kcal, exercise_minutes, sleep_seconds, resting_heart_rate, hrv_sdnn_ms")
      .gte("metric_date", localDateStrDaysAgo(90))
      .order("metric_date", { ascending: true }),
    supabase.from("nutrition_config").select("*").maybeSingle(),
    supabase
      .from("nutrition_entries")
      .select("entry_date, calorie_target, calories, tdee, deficit_target")
      .gte("entry_date", localDateStrDaysAgo(60))
      .order("entry_date", { ascending: true }),
    // Training + archived exercises for the Decision Engine's training slice.
    // Best-effort (see below): a failure here must not abort the nutrition
    // recompute, so these two reads are NOT in the throw-on-error guard.
    supabase
      .from("training_logs")
      .select("exercise_slug, raw, log_date")
      .order("log_date", { ascending: true }),
    // slug + archived + compound: archived filters the training slice, compound
    // picks the score axis (e1RM vs tonnage) so the engine's decline verdict
    // matches the Training Health card instead of judging isolation lifts on e1RM.
    supabase.from("exercises").select("slug, archived, compound, assisted_mode"),
    // Prior surfaced recommendation — feeds the engine's exit-hysteresis so a
    // marginal signal wobble can't flip the weekly directive. A plain read; null
    // before the first evaluation ever ran.
    getNutritionState(),
  ]);

  // Abort on a failed read rather than recomputing from silently-empty data —
  // that would persist a wrong evaluation over the last good one. Callers are
  // fire-and-forget, so throwing here simply skips this recompute.
  if (metricsRes.error) throw metricsRes.error;
  if (configRes.error) throw configRes.error;
  if (entriesRes.error) throw entriesRes.error;

  // Sanitize at this read boundary too (this path queries health_metrics
  // directly, bypassing fetchHealthData): implausible body-fat must not reach
  // buildGoalStatus / buildLeanMassEvaluation and corrupt the persisted engine
  // verdict (e.g. a stray 0.22 firing a false "Start maintenance").
  const metrics = sanitizeMetrics((metricsRes.data ?? []) as BodyMetric[]);
  const config = (configRes.data as NutritionConfig | null) ?? null;
  const entries = entriesRes.data ?? [];

  const targets = config ? targetsFromConfig(config) : null;
  const calorieTarget = targets?.calorieTarget ?? DEFAULTS.tdee - DEFAULTS.deficitTarget;
  const cutMode = targets?.cutPhaseName ?? phaseFromDeficit(DEFAULTS.deficitTarget);

  const { tdee } = computeTdeeWindows(metrics);
  const estimatedTdee = tdee.tdee ?? targets?.tdee ?? DEFAULTS.tdee;

  const weightSeries = series(metrics, "weight_kg");
  const daysOnTarget = trailingDaysOnTarget(entries, calorieTarget);
  const loggedIntake = windowedLoggedIntake(entries);

  const { evaluation, diagnostics } = evaluate({
    weightSeries,
    cutMode,
    calorieTarget,
    estimatedTdee,
    daysOnTarget,
    loggedIntake,
    now: new Date(),
  });

  // Recommendation is derived from the Evaluations — the single source of truth.
  // This assembler holds every domain's raw inputs, so it builds all four
  // Evaluation slices and hands them to the Decision Engine (topRecommendation),
  // which walks the precedence ladder across them.
  const recovery = buildRecoveryEvaluation(metrics);
  const leanMass = buildLeanMassEvaluation(metrics);

  // Training slice — best-effort. A training read failure must not block the
  // nutrition recompute, so on error we omit the slice (the engine treats absent
  // training as "no info", never a bad-news signal). The summary + compound set
  // are kept in scope: the phase triggers read the same per-lift trajectories.
  let training = null;
  let strengthSummary = null;
  let compoundSlugs = new Set<string>();
  if (!logsRes.error && !archivedRes.error) {
    const archivedSlugs = new Set(
      (archivedRes.data ?? []).filter((e) => e.archived).map((e) => e.slug),
    );
    compoundSlugs = new Set(
      (archivedRes.data ?? []).filter((e) => e.compound).map((e) => e.slug),
    );
    // Assisted-mode exercises score their axis in %BW (see scoreWeight) — pass the
    // set so the engine's strength verdict matches the Training card's axis.
    const assistedSlugs = new Set(
      (archivedRes.data ?? []).filter((e) => e.assisted_mode).map((e) => e.slug),
    );
    const bySlug: Record<string, { log_date: string | null; raw: string | null }[]> = {};
    for (const l of logsRes.data ?? []) {
      if (!l.exercise_slug || archivedSlugs.has(l.exercise_slug)) continue;
      (bySlug[l.exercise_slug] ??= []).push(l);
    }
    strengthSummary = computeStrengthSummary(bySlug, compoundSlugs, undefined, true, assistedSlugs);
    training = buildTrainingEvaluation(strengthSummary);
  }

  // Phase slice (plateau triggers — evaluation only, the engine owns the policy)
  // and goal slice (is the cut's body-fat endpoint reached?).
  const phase = evaluatePhaseTriggers({
    metrics,
    strength: strengthSummary,
    compoundSlugs,
    entries,
    today: localDateStrDaysAgo(0),
  });
  const goal = buildGoalStatus(metrics, config?.target_body_fat_pct ?? null);

  // Carry forward a recovery dismiss, auto-clearing it once its premise is gone:
  // the user's back to training (the sick/travel window ended — trainingLoad flips
  // to "trained") or a 10-day safety cap has passed (so a lingering low can never
  // be hidden indefinitely). Un-cleared, it suppresses the recovery rung below.
  const today = localDateStrDaysAgo(0);
  let recoveryDismissedAt = priorState?.recoveryDismissedAt ?? null;
  if (recoveryDismissedAt != null) {
    const daysSince = Math.floor(
      (Date.parse(today + "T00:00:00") - Date.parse(recoveryDismissedAt + "T00:00:00")) / 86400000,
    );
    if (recovery.trainingLoad === "trained" || daysSince > RECOVERY_DISMISS_MAX_DAYS) {
      recoveryDismissedAt = null;
    }
  }

  const recommendation = topRecommendation(
    {
      nutrition: { evaluation, diagnostics },
      recovery,
      training,
      leanMass,
      phase,
      goal,
      recoveryDismissed: recoveryDismissedAt != null,
    },
    priorState?.recommendation ?? null,
  );
  const state: NutritionStateFull = { evaluation, diagnostics, recommendation, recoveryDismissedAt };

  // A shared viewer computes from the owner's data (RLS) but must not persist —
  // the row belongs to the owner and the write would be rejected anyway.
  if (await isViewer()) return state;

  const { error } = await supabase
    .from("nutrition_evaluations")
    .upsert(stateToRow(userId, state), { onConflict: "user_id" });
  if (error) throw error;

  return state;
}
