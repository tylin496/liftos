import { supabase } from "@shared/lib/supabase";
import { fetchHealthData, type BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import { parse, score } from "@features/training/parser";
import { epley1RM } from "@features/training/logic";
import { getNutritionState, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import { computeGoal, cutBaselineAt, type Goal } from "./goal";
import { saveConfig } from "@features/nutrition/api";

export type StrengthStatus = "improving" | "stable" | "watch";

export interface StrengthExercise {
  slug: string;
  name: string;
  status: StrengthStatus;
  latestE1RM: number;  // most recent session best
  prE1RM: number;      // all-time best across all sessions
  trend: number;       // latestE1RM / prE1RM — distance-from-PR ratio that drives `status`
  stalledWeeks: number; // whole weeks since the last session that set a new best
  lastLogDate: string;  // ISO date of the most recent session — for staleness labelling
}

export interface StrengthSummary {
  improving: number;
  stable: number;
  watch: number;
  total: number; // exercises with enough data
  exercises: StrengthExercise[];
}

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
}

/** Logs grouped by exercise slug — the only shape the strength computation
 *  needs. Rows may arrive in any date order (sorted internally). */
type LogsBySlug = Record<string, Array<{ log_date: string | null; raw: string | null }>>;

/**
 * Per-exercise strength trend — the single source for the Training Health card,
 * shared by Overview (fetchOverview) and the Training tab (computed from the
 * logs it already holds). Needs ≥4 sessions per exercise to compare recent-3
 * vs prior. Pure: pass logs grouped by slug, get the summary back.
 */
export function computeStrengthSummary(logsBySlug: LogsBySlug): StrengthSummary {
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, total: 0, exercises: [] };

  for (const [slug, slugLogs] of Object.entries(logsBySlug)) {
    // Performance trend: need ≥4 logs to compare recent 3 vs prior sessions
    if (slugLogs.length < 4) continue;
    strength.total++;

    // Group by date (a day = one session), take best e1RM per date
    const byDate: Record<string, number> = {};
    for (const l of slugLogs) {
      if (!l.log_date || !l.raw) continue;
      const p = parse(l.raw);
      if (!p) continue;
      const w = score(p);
      if (!Number.isFinite(w)) continue;
      const e = epley1RM(w, p.reps);
      byDate[l.log_date] = Math.max(byDate[l.log_date] ?? 0, e);
    }
    // Sort ascending by date so recent/prior slices are correct regardless of
    // the caller's row order (Overview queries asc; the Training tab keeps logs
    // newest-first).
    const datedBests = Object.entries(byDate)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const sessionBests = datedBests.map(([, v]) => v);
    if (sessionBests.length < 4) { strength.total--; continue; }

    const latestE1RM = sessionBests[sessionBests.length - 1];
    const prE1RM = Math.max(...sessionBests);

    // Status = distance from PR, NOT recent-vs-prior slope. This user logs
    // asymmetrically — they only record a session when strength DROPS (or on a
    // PR); maintained days are left unlogged. So a recent-vs-prior slope reads
    // that biased sample as decline even while they're holding. Judging purely
    // by "how far below PR is the last recorded session" makes maintenance the
    // healthy default and only flags a genuine, meaningful drop.
    const pct = prE1RM > 0 ? latestE1RM / prE1RM : 0;
    let status: StrengthStatus;
    if (pct >= 0.997) { strength.improving++; status = "improving"; }  // at / new PR
    else if (pct >= 0.94) { strength.stable++; status = "stable"; }    // holding
    else { strength.watch++; status = "watch"; }                      // real drop below PR

    // Weeks stalled: span from the last session that set a new running best to
    // the most recent session. A rising lift lands its PR on (or near) the last
    // session → ~0; a stalled one carries weeks of no new best.
    let runningMax = -Infinity;
    let prDate = datedBests[0][0];
    for (const [date, e] of datedBests) {
      if (e > runningMax) { runningMax = e; prDate = date; }
    }
    const lastDate = datedBests[datedBests.length - 1][0];
    const stalledWeeks = Math.floor(
      (Date.parse(lastDate) - Date.parse(prDate)) / (7 * 24 * 60 * 60 * 1000),
    );

    strength.exercises.push({
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      status,
      latestE1RM,
      prE1RM,
      trend: pct,
      stalledWeeks,
      lastLogDate: lastDate,
    });
  }

  return strength;
}

export async function fetchOverview(): Promise<OverviewData> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const userId = userData.user.id;

  const [health, logsRes, nutritionState, configRes] = await Promise.all([
    // 180 days of body metrics. Recovery's 7/30-day windows anchor to the latest
    // reading, so the wider window doesn't shift its baseline.
    fetchHealthData(180),
    supabase
      .from("training_logs")
      .select("exercise_slug, raw, log_date")
      .order("log_date", { ascending: true }),
    // Shared nutrition state — a plain read; recompute happens on data change.
    getNutritionState(),
    // Goal Provider config: the target plus the persisted cut baseline
    // (cut_start_date + cut_start_body_fat_pct). Set once via config and only ever
    // read here — there is no in-app UI. To restart a cut, edit these directly.
    supabase
      .from("nutrition_config")
      .select("target_body_fat_pct, cut_start_date, cut_start_body_fat_pct")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // Supabase resolves failed queries as { data: null, error } instead of
  // rejecting — check explicitly so a transient failure surfaces the real
  // ErrorState instead of silently reading back as "no data".
  if (logsRes.error) throw logsRes.error;
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

  // Group logs by exercise for the performance-trend summary
  const bySlug: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!l.exercise_slug) continue;
    (bySlug[l.exercise_slug] ??= []).push(l);
  }

  const strength = computeStrengthSummary(bySlug);

  // Primary Goal — computed entirely upstream in the Provider. The card only
  // renders the finished payload; swapping goal types never touches this call.
  // Progress is anchored to the persisted cut baseline body fat.
  const goal = computeGoal(
    metrics as BodyMetric[],
    configRes.data?.target_body_fat_pct ?? null,
    configRes.data?.cut_start_body_fat_pct ?? null,
  );

  return {
    weightLatest,
    activeEnergy,
    activeChange,
    strength,
    nutritionState,
    goal,
    targetBodyFat: configRes.data?.target_body_fat_pct ?? null,
    cutStartDate: configRes.data?.cut_start_date ?? null,
    metrics: metrics as BodyMetric[],
    targetTdee: health.targetTdee,
    currentTdee: health.tdee.tdee,
    activeTarget: health.activeTarget,
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

