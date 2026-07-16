import { supabase } from "@shared/lib/supabase";
import { fetchHealthData, type BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import { getNutritionState, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import {
  computeGoal,
  cutBaselineAt,
  buildGoalStatus,
  buildBulkGoalStatus,
  type Goal,
  type GoalStatusEvaluation,
  type BulkGoalStatusEvaluation,
} from "./goal";
import { evaluatePhaseTriggers, type PhaseTriggerResult } from "./phaseTriggers";
import { maintenanceStartDate, MAINTENANCE_LOOKBACK_DAYS } from "@features/nutrition/logic";
import { localDateStrDaysAgo } from "@shared/lib/date";
import { saveConfig } from "@features/nutrition/api";
import {
  computeStrengthSummary,
  type StrengthExercise,
  type StrengthSummary,
} from "./strength";

// Re-exported so existing consumers keep importing these from `overview/api`
// (Training Health card, copyAllData export, Training page) unchanged — the
// computation itself now lives in ./strength. See that file for why the split
// exists (breaking an overview/api ↔ evaluationApi import cycle).
export {
  computeStrengthSummary,
  type StrengthExercise,
  type StrengthSummary,
};

export interface OverviewData {
  weightLatest: number | null;
  /** 14-day average active energy (kcal/day). The one metabolic input worth
   *  surfacing here — it moves daily and is behaviour-controllable, unlike
   *  resting/TDEE. Rides in the Weight card as it explains the weight pace. */
  activeEnergy: number | null;
  /** Active energy change vs the prior 14–28d window — the up-good delta. */
  activeChange: number | null;
  strength: StrengthSummary;
  /** Shared nutrition evaluation + recommendation (single source of truth).
   *  Feeds the System, Weight, and Nutrition cards — Overview never recomputes. */
  nutritionState: NutritionStateFull | null;
  /** Primary Goal payload, finished by the upstream Provider (`goal.ts`).
   *  Null when there's no target or not enough body-composition data. */
  goal: Goal | null;
  /** Target body fat from config (null = goal not configured). */
  targetBodyFat: number | null;
  /** Persisted cut-start date, or null when no baseline is set yet — the card
   *  shows its one-time initializer in that state. */
  cutStartDate: string | null;
  /** Persisted smoothed weight (kg) at the cut baseline. Card subtracts the
   *  current weight from this to show how much has been lost since the start. */
  cutStartWeight: number | null;
  /** Raw body metrics — the initializer snapshots the baseline at a chosen date
   *  from these (once, at Save). */
  metrics: BodyMetric[];
  /** User-set maintenance TDEE goal (null until configured) — feeds Active Target. */
  targetTdee: number | null;
  /** Current computed TDEE (resting + active) — the Active Target chip's "current". */
  currentTdee: number | null;
  /** Derived active-calorie target + this-week pace, null until both a goal and a
   *  resting-energy baseline exist. See health/activeTarget.ts. */
  activeTarget: ActiveTargetView | null;
  /** Plateau-trigger lights for the Journey card's Plan section — the SAME pure
   *  evaluation the Decision Engine reads (phaseTriggers.ts computes, both
   *  consume; neither re-derives the other's view). */
  phase: PhaseTriggerResult;
  /** "Is the cut's body-fat endpoint reached?" — same formula as the engine's
   *  goal slice and computeGoal's bodyFat14dAvg, so the three never disagree. */
  goalStatus: GoalStatusEvaluation;
  /** The bulk mirror — "is the body-fat CEILING reached?". Meaningful only
   *  while the phase is a bulk with a configured ceiling; harmless otherwise. */
  bulkGoalStatus: BulkGoalStatusEvaluation;
  /** Persisted bulk baseline + endpoint (0017) — null until the bulk's one-time
   *  initializer runs (or pre-migration, where the columns read back null). */
  bulkStartDate: string | null;
  bulkStartWeight: number | null;
  bulkStartBodyFat: number | null;
  bulkBfCeiling: number | null;
  /** First day of the current maintenance block (derived from the entries' own
   *  deficit snapshots — see maintenanceStartDate), or null while cutting /
   *  before any maintenance day is logged. Data-layer only for now: the Plan
   *  section deliberately shows no week counter (kept lean by design); this is
   *  ready for wherever the block's progress ends up surfacing. */
  maintenanceSince: string | null;
}

export async function fetchOverview(): Promise<OverviewData> {
  const [health, logsRes, exercisesRes, nutritionState, configRes, entriesRes] = await Promise.all([
    // 180 days of body metrics. Recovery's 7/30-day windows anchor to the latest
    // reading, so the wider window doesn't shift its baseline.
    fetchHealthData(180),
    supabase
      .from("training_logs")
      .select("exercise_slug, raw, log_date")
      .order("log_date", { ascending: true }),
    // All exercises' flags: `archived` (excluded from the strength watch list —
    // retired, not stalled) and `compound` (earns round-weight milestones on the
    // reward row). Fetched together to avoid a second round trip.
    supabase.from("exercises").select("slug, name, archived, compound"),
    // Shared nutrition state — a plain read; recompute happens on data change.
    getNutritionState(),
    // Goal Provider config: the target plus the persisted cut/bulk baselines.
    // select("*") rather than named columns so the read tolerates a not-yet-
    // applied migration (an explicit select of a missing column errors in
    // PostgREST); one row, so the wildcard costs nothing. Bulk fields are read
    // with ?? null below for the same reason.
    supabase
      .from("nutrition_config")
      .select("*")
      .maybeSingle(),
    // Recent per-day nutrition entries — the adherence trigger reads the last
    // fortnight, the maintenance-week counter scans further back for the
    // block's first day (the wider window is harmless to the trigger, which
    // applies its own cutoff). Best-effort (not in the throw guard below): a
    // failed read means an "unknown" light, never a broken Overview.
    supabase
      .from("nutrition_entries")
      .select("entry_date, calories, tdee, deficit_target")
      .gte("entry_date", localDateStrDaysAgo(MAINTENANCE_LOOKBACK_DAYS))
      .order("entry_date", { ascending: true }),
  ]);

  // Supabase resolves failed queries as { data: null, error } instead of
  // rejecting — check explicitly so a transient failure surfaces the real
  // ErrorState instead of silently reading back as "no data".
  if (logsRes.error) throw logsRes.error;
  if (exercisesRes.error) throw exercisesRes.error;
  if (configRes.error) throw configRes.error;

  // Weight — latest reading. The trend/status the Weight card shows comes from
  // the shared nutrition evaluation (single weight-trend source), not a 7-day
  // point-to-point delta.
  const metrics = health.metrics;
  const weightLatestRaw = metrics.filter((m) => m.weight_kg != null).at(-1)?.weight_kg ?? null;
  const weightLatest = weightLatestRaw != null ? Math.round(weightLatestRaw * 10) / 10 : null;

  // Active energy — reuse the Health tab's TDEE windows verbatim (single source
  // of truth, already computed in fetchHealthData). Only the 14-day active
  // average + its trend arrow ride onto the Weight card; resting/TDEE stay in
  // Health as background model state.
  const activeEnergy = health.tdee.avgActive;
  const activeChange =
    health.tdee.avgActive != null && health.tdeePrev.avgActive != null
      ? health.tdee.avgActive - health.tdeePrev.avgActive
      : null;

  // Training logs
  const logs = logsRes.data ?? [];

  // Group logs by exercise for the performance-trend summary, excluding
  // archived exercises — they're retired, not stalled.
  const archivedSlugs = new Set((exercisesRes.data ?? []).filter((e) => e.archived).map((e) => e.slug));
  const compoundSlugs = new Set((exercisesRes.data ?? []).filter((e) => e.compound).map((e) => e.slug));
  const namesBySlug = Object.fromEntries((exercisesRes.data ?? []).map((e) => [e.slug, e.name]));
  const bySlug: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!l.exercise_slug || archivedSlugs.has(l.exercise_slug)) continue;
    (bySlug[l.exercise_slug] ??= []).push(l);
  }

  const strength = computeStrengthSummary(bySlug, compoundSlugs, namesBySlug);

  // Primary Goal — computed entirely upstream in the Provider. The card only
  // renders the finished payload; swapping goal types never touches this call.
  // Progress and the goal weight are anchored to the persisted cut baseline
  // (weight + body fat) — see goal.ts for why progress is weight-, not
  // body-fat-, based.
  const goal = computeGoal(
    metrics as BodyMetric[],
    configRes.data?.target_body_fat_pct ?? null,
    configRes.data?.cut_start_body_fat_pct ?? null,
    configRes.data?.cut_start_weight ?? null,
  );

  // Plateau-trigger lights + goal status — the same pure evaluations the
  // Decision Engine consumed at recompute time, replayed here on Overview's own
  // (fresher, wider) data. One implementation, two evaluation moments — exactly
  // like the persisted recommendation vs the live cards.
  const entries = entriesRes.error ? [] : (entriesRes.data ?? []);
  const phase = evaluatePhaseTriggers({
    metrics: metrics as BodyMetric[],
    strength,
    compoundSlugs,
    entries,
    today: localDateStrDaysAgo(0),
    // Same phase snapshot the persisted evaluation carries — null state (first
    // run) just keeps the cut wording.
    phaseKind: nutritionState?.evaluation.phaseKind,
  });
  const goalStatus = buildGoalStatus(metrics as BodyMetric[], configRes.data?.target_body_fat_pct ?? null);
  const bulkBfCeiling = configRes.data?.bulk_bf_ceiling ?? null;
  const bulkGoalStatus = buildBulkGoalStatus(metrics as BodyMetric[], bulkBfCeiling);
  const maintenanceSince = maintenanceStartDate(entries);

  return {
    weightLatest,
    activeEnergy,
    activeChange,
    strength,
    nutritionState,
    goal,
    targetBodyFat: configRes.data?.target_body_fat_pct ?? null,
    cutStartDate: configRes.data?.cut_start_date ?? null,
    cutStartWeight: configRes.data?.cut_start_weight ?? null,
    metrics: metrics as BodyMetric[],
    targetTdee: health.targetTdee,
    currentTdee: health.tdee.tdee,
    activeTarget: health.activeTarget,
    phase,
    goalStatus,
    bulkGoalStatus,
    bulkStartDate: configRes.data?.bulk_start_date ?? null,
    bulkStartWeight: configRes.data?.bulk_start_weight ?? null,
    bulkStartBodyFat: configRes.data?.bulk_start_body_fat_pct ?? null,
    bulkBfCeiling,
    maintenanceSince,
  };
}

/** Anchor the cut baseline to `startDate` — the one-time initialization. Snapshots
 *  the smoothed body composition at that date into config, freezing the Cut Progress
 *  starting line (progress reads the persisted value, never recomputed). After this
 *  the initializer never shows again (cut_start_date is set). To restart a cut later,
 *  edit the nutrition_config.cut_start_* fields directly — there is intentionally no
 *  in-app restart/reset/cancel flow. Throws if the date has no readings nearby. */
export async function saveCutBaseline(startDate: string, metrics: BodyMetric[]) {
  const { bodyFatPct, weightKg } = cutBaselineAt(metrics, startDate);
  if (bodyFatPct == null) {
    throw new Error("No body-fat readings near that date to anchor the baseline.");
  }
  return saveConfig({
    cut_start_date: startDate,
    cut_start_body_fat_pct: bodyFatPct,
    cut_start_weight: weightKg,
  });
}
