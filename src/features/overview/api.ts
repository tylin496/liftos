import { supabase } from "@shared/lib/supabase";
import { computeRecovery, type RecoverySnapshot } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";
import { parse, score } from "@features/training/parser";
import { epley1RM } from "@features/training/logic";
import { localDateStrDaysAgo } from "@shared/lib/date";
import { getNutritionState, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import { computeGoal, type Goal } from "./goal";

function sinceDate(days: number): string {
  return localDateStrDaysAgo(days);
}

export type StrengthStatus = "improving" | "stable" | "watch";

export interface StrengthExercise {
  slug: string;
  name: string;
  status: StrengthStatus;
  latestE1RM: number;  // most recent session best
  prE1RM: number;      // all-time best across all sessions
  trend: number;       // recent-3-avg / prior-avg — the ratio that drives `status`
  stalledWeeks: number; // whole weeks since the last session that set a new best
}

export interface StrengthSummary {
  improving: number;
  stable: number;
  watch: number;
  total: number; // exercises with enough data
  exercises: StrengthExercise[];
}

export interface CompoundItem {
  slug: string;
  label: string;
  pct: number; // 0–1
}

export interface CompoundProgress {
  overall: number; // 0–1, average of items
  items: CompoundItem[];
}

export interface OverviewData {
  weightLatest: number | null;
  recovery: RecoverySnapshot | null;
  strength: StrengthSummary;
  compoundProgress: CompoundProgress | null;
  /** Shared nutrition evaluation + recommendation (single source of truth).
   *  Feeds the System, Weight, and Nutrition cards — Overview never recomputes. */
  nutritionState: NutritionStateFull | null;
  /** Primary Goal payload, finished by the upstream Provider (`goal.ts`).
   *  Null when there's no target or not enough body-composition data. */
  goal: Goal | null;
}

// Pull is resolved dynamically (first exercise in Pull split by sort_order).
// The others are stable slug references.
const FIXED_COMPOUNDS: { slug: string; label: string }[] = [
  { slug: "bench-press", label: "Bench" },
  { slug: "squat",       label: "Squat" },
  { slug: "rdl",         label: "RDL"   },
];

function compoundPct(slugLogs: Array<{ log_date: string | null; raw: string | null }>): number | null {
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
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return null;
  const prE1RM = Math.max(...Object.values(byDate));
  const currentE1RM = byDate[dates[dates.length - 1]];
  return Math.min(1, currentE1RM / prE1RM);
}

export async function fetchOverview(): Promise<OverviewData> {
  const [metricsRes, logsRes, pullFirstRes, rowFirstRes, nutritionState, configRes] = await Promise.all([
    supabase
      .from("health_metrics")
      .select("metric_date, weight_kg, body_fat_pct, active_energy_kcal, resting_energy_kcal, sleep_seconds, hrv_sdnn_ms, resting_heart_rate")
      .gte("metric_date", sinceDate(60))
      .order("metric_date", { ascending: true }),
    supabase
      .from("training_logs")
      .select("exercise_slug, raw, log_date")
      .order("log_date", { ascending: true }),
    supabase
      .from("exercises")
      .select("slug")
      .eq("split", "pull")
      .eq("archived", false)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("exercises")
      .select("slug")
      .eq("split", "pull")
      .eq("archived", false)
      .ilike("name", "%row%")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
    // Shared nutrition state — a plain read; recompute happens on data change.
    getNutritionState(),
    // Target body fat — the Goal Provider's only config input.
    supabase.from("nutrition_config").select("target_body_fat_pct").maybeSingle(),
  ]);

  // Weight — latest reading. The trend/status the Weight card shows comes from
  // the shared nutrition evaluation (single weight-trend source), not a 7-day
  // point-to-point delta.
  const metrics = metricsRes.data ?? [];
  const weightLatest = metrics.filter((m) => m.weight_kg != null).at(-1)?.weight_kg ?? null;

  // Recovery: reuse the Health tab's calculation verbatim (single source of
  // truth). The 60-day metrics window covers its 30-day baseline. Null status
  // means no recovery data → the card renders its empty state.
  const recoverySnap = computeRecovery(metrics as BodyMetric[]);
  const recovery = recoverySnap.status ? recoverySnap : null;

  // Training logs
  const logs = logsRes.data ?? [];

  // Group logs by exercise for the performance-trend summary
  const bySlug: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!l.exercise_slug) continue;
    (bySlug[l.exercise_slug] ??= []).push(l);
  }

  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, total: 0, exercises: [] };

  for (const slugLogs of Object.values(bySlug)) {
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
    // Dates ascending (query is ordered by log_date), each with its session best.
    const datedBests = Object.entries(byDate).filter(([, v]) => v > 0);
    const sessionBests = datedBests.map(([, v]) => v);
    if (sessionBests.length < 4) { strength.total--; continue; }

    // recent 3 vs the rest (prior sessions)
    const recent = sessionBests.slice(-3);
    const prior = sessionBests.slice(0, -3);
    const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length;

    const ratio = recentAvg / priorAvg;
    let status: StrengthStatus;
    if (ratio >= 1.01) { strength.improving++; status = "improving"; }
    else if (ratio >= 0.97) { strength.stable++; status = "stable"; }
    else { strength.watch++; status = "watch"; }
    const slug = slugLogs[0].exercise_slug!;
    const latestE1RM = recent[recent.length - 1];
    const prE1RM = Math.max(...sessionBests);

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
      trend: ratio,
      stalledWeeks,
    });
  }

  const pullSlug = pullFirstRes.data?.slug ?? null;
  const rowSlug  = rowFirstRes.data?.slug  ?? null;
  const compounds: { slug: string; label: string }[] = [
    FIXED_COMPOUNDS[0],                                           // Bench
    ...(pullSlug ? [{ slug: pullSlug, label: "Pull" }] : []),    // first of Pull split
    ...(rowSlug  ? [{ slug: rowSlug,  label: "Row"  }] : []),    // first "row" exercise in Pull split
    ...FIXED_COMPOUNDS.slice(1),                                  // Squat, RDL
  ];

  const compoundItems: CompoundItem[] = compounds.flatMap(({ slug, label }) => {
    const pct = compoundPct(bySlug[slug] ?? []);
    return pct !== null ? [{ slug, label, pct }] : [];
  });
  const compoundProgress: CompoundProgress | null = compoundItems.length
    ? {
        overall: compoundItems.reduce((s, x) => s + x.pct, 0) / compoundItems.length,
        items: compoundItems,
      }
    : null;

  // Primary Goal — computed entirely upstream in the Provider. The card only
  // renders the finished payload; swapping goal types never touches this call.
  const goal = computeGoal(metrics as BodyMetric[], configRes.data?.target_body_fat_pct ?? null);

  return {
    weightLatest,
    recovery,
    strength,
    compoundProgress,
    nutritionState,
    goal,
  };
}
