import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { computeTdeeWindows } from "@features/health/tdee";
import { computeRecovery, type RecoverySnapshot } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";
import { parse, score } from "@features/training/parser";
import { epley1RM } from "@features/training/logic";
import { localDateStrDaysAgo } from "@shared/lib/date";
import { defaultLogDate, DEFAULTS } from "@features/nutrition/logic";
import { targetsFromConfig } from "@features/nutrition/api";
import { getNutritionState, type NutritionStateFull } from "@features/nutrition/evaluationApi";

type NutritionEntry = Database["public"]["Tables"]["nutrition_entries"]["Row"];

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
  today: NutritionEntry | null;
  nutritionTargets: {
    calorieTarget: number;
    proteinTarget: number;
    tdeeTarget: number;
    deficitTarget: number;
  } | null;
  weightLatest: number | null;
  weightWeekAgo: number | null;
  tdee: number | null;
  tdeePrev: number | null;
  recovery: RecoverySnapshot | null;
  strength: StrengthSummary;
  compoundProgress: CompoundProgress | null;
  /** Shared nutrition evaluation + recommendation (single source of truth).
   *  Read straight from the persisted row — Overview never recomputes it. */
  nutritionState: NutritionStateFull | null;
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
  const today = defaultLogDate();
  const weekAgo = sinceDate(7);

  const [entryRes, configRes, metricsRes, logsRes, pullFirstRes, rowFirstRes, nutritionState] = await Promise.all([
    supabase
      .from("nutrition_entries")
      .select("*")
      .eq("entry_date", today)
      .maybeSingle(),
    supabase
      .from("nutrition_config")
      .select("tdee, protein_target, phase_deficits")
      .maybeSingle(),
    supabase
      .from("health_metrics")
      .select("metric_date, weight_kg, active_energy_kcal, resting_energy_kcal, sleep_seconds, hrv_sdnn_ms, resting_heart_rate")
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
  ]);

  // Nutrition — reuse Nutrition's own target derivation so Overview's Hero
  // card can compute the exact same on-plan/over/surplus state as Nutrition's
  // Today card (same underlying daily entry, same feedback).
  const todayEntry = entryRes.data ?? null;
  let nutritionTargets: OverviewData["nutritionTargets"] = null;
  if (todayEntry) {
    nutritionTargets = {
      calorieTarget: todayEntry.calorie_target ?? 0,
      proteinTarget: todayEntry.protein_target ?? 0,
      tdeeTarget: todayEntry.tdee ?? DEFAULTS.tdee,
      deficitTarget: todayEntry.deficit_target ?? DEFAULTS.deficitTarget,
    };
  } else if (configRes.data) {
    const t = targetsFromConfig(
      configRes.data as Pick<
        Database["public"]["Tables"]["nutrition_config"]["Row"],
        "tdee" | "protein_target" | "phase_deficits"
      > as Database["public"]["Tables"]["nutrition_config"]["Row"],
    );
    nutritionTargets = {
      calorieTarget: t.calorieTarget,
      proteinTarget: t.proteinTarget,
      tdeeTarget: t.tdee,
      deficitTarget: t.deficitTarget,
    };
  }

  // Weight
  const metrics = metricsRes.data ?? [];
  const weightPoints = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, w: m.weight_kg as number }));
  const weightLatest = weightPoints.at(-1)?.w ?? null;
  const weekAgoMetric = weightPoints.filter((m) => m.date <= weekAgo).at(-1);
  const weightWeekAgo = weekAgoMetric?.w ?? null;

  // TDEE: shared windowing (30-day resting + 14-day active) — same source of
  // truth as the Health card so the two TDEE numbers never diverge.
  const { tdee: tdeeEst, tdeePrev: tdeePrevEst } = computeTdeeWindows(metrics);
  const tdee = tdeeEst.tdee;
  const tdeePrev = tdeePrevEst.tdee;

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

  return {
    today: todayEntry,
    nutritionTargets,
    weightLatest,
    weightWeekAgo,
    tdee,
    tdeePrev,
    recovery,
    strength,
    compoundProgress,
    nutritionState,
  };
}
