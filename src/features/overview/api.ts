import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { estimateTdee } from "@features/health/tdee";
import { parse, score } from "@features/training/parser";
import { epley1RM } from "@features/training/logic";

type NutritionEntry = Database["public"]["Tables"]["nutrition_entries"]["Row"];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export type StrengthStatus = "improving" | "stable" | "watch";

export interface StrengthExercise {
  slug: string;
  name: string;
  status: StrengthStatus;
  latestE1RM: number;  // most recent session best
  prE1RM: number;      // all-time best across all sessions
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
  nutritionTargets: { calorieTarget: number; proteinTarget: number } | null;
  weightLatest: number | null;
  weightWeekAgo: number | null;
  tdee: number | null;
  tdeePrev: number | null;
  tdeeTrend: { date: string; value: number }[];
  prThisMonth: number;
  sessionsThisWeek: number;
  strength: StrengthSummary;
  compoundProgress: CompoundProgress | null;
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
  const today = isoToday();
  const monthStart = isoMonthStart();
  const weekAgo = sinceDate(7);

  const [entryRes, configRes, metricsRes, logsRes, pullFirstRes, rowFirstRes] = await Promise.all([
    supabase
      .from("nutrition_entries")
      .select("*")
      .eq("entry_date", today)
      .maybeSingle(),
    supabase
      .from("nutrition_config")
      .select("calorie_target, protein_target")
      .maybeSingle(),
    supabase
      .from("body_metrics")
      .select("metric_date, weight_kg, active_energy_kcal, resting_energy_kcal")
      .gte("metric_date", sinceDate(44))
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
  ]);

  // Nutrition
  const todayEntry = entryRes.data ?? null;
  let nutritionTargets: OverviewData["nutritionTargets"] = null;
  if (todayEntry) {
    nutritionTargets = {
      calorieTarget: todayEntry.calorie_target ?? 0,
      proteinTarget: todayEntry.protein_target ?? 0,
    };
  } else if (configRes.data) {
    const cfg = configRes.data as { calorie_target?: number; protein_target?: number };
    if (cfg.calorie_target || cfg.protein_target) {
      nutritionTargets = {
        calorieTarget: cfg.calorie_target ?? 0,
        proteinTarget: cfg.protein_target ?? 0,
      };
    }
  }

  // Weight
  const metrics = metricsRes.data ?? [];
  const weightPoints = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, w: m.weight_kg as number }));
  const weightLatest = weightPoints.at(-1)?.w ?? null;
  const weekAgoMetric = weightPoints.filter((m) => m.date <= weekAgo).at(-1);
  const weightWeekAgo = weekAgoMetric?.w ?? null;

  // TDEE: 30-day resting avg + 14-day active avg (metrics span 44 days)
  const cutoff14 = sinceDate(14);
  const tdeeEst = estimateTdee(
    metrics.map((m) => ({ resting: m.resting_energy_kcal })),
    metrics
      .filter((m) => m.metric_date >= cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );
  const tdee = tdeeEst.tdee;

  // TDEE 14 days ago: same algorithm, window ending at cutoff14
  const cutoff28 = sinceDate(28);
  const tdeePrevEst = estimateTdee(
    metrics
      .filter((m) => m.metric_date < cutoff14)
      .map((m) => ({ resting: m.resting_energy_kcal })),
    metrics
      .filter((m) => m.metric_date >= cutoff28 && m.metric_date < cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );
  const tdeePrev = tdeePrevEst.tdee;

  // Daily TDEE trend: days where both active + resting are present
  const tdeeTrend = metrics
    .filter((m) => m.active_energy_kcal != null && m.resting_energy_kcal != null)
    .map((m) => ({ date: m.metric_date, value: m.active_energy_kcal! + m.resting_energy_kcal! }));

  // Training logs
  const logs = logsRes.data ?? [];

  // Sessions this week = distinct log_date in last 7 days
  const recentDates = new Set(
    logs.filter((l) => l.log_date && l.log_date >= weekAgo).map((l) => l.log_date),
  );
  const sessionsThisWeek = recentDates.size;

  // PRs this month = exercises where best e1RM this month > all-time best before this month
  const bySlug: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!l.exercise_slug) continue;
    (bySlug[l.exercise_slug] ??= []).push(l);
  }

  let prThisMonth = 0;
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, total: 0, exercises: [] };

  for (const slugLogs of Object.values(bySlug)) {
    // PR count
    const before = slugLogs.filter((l) => l.log_date && l.log_date < monthStart);
    const thisMonth = slugLogs.filter((l) => l.log_date && l.log_date >= monthStart);
    if (thisMonth.length) {
      const bestBefore = maxE1RM(before.map((l) => ({ raw: l.raw })));
      const bestThis = maxE1RM(thisMonth.map((l) => ({ raw: l.raw })));
      if (bestThis > bestBefore) prThisMonth++;
    }

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
    const sessionBests = Object.values(byDate).filter((v) => v > 0);
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
    strength.exercises.push({
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      status,
      latestE1RM,
      prE1RM,
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
    tdeeTrend,
    prThisMonth,
    sessionsThisWeek,
    strength,
    compoundProgress,
  };
}

function maxE1RM(logs: Array<{ raw: string | null }>): number {
  let best = 0;
  for (const l of logs) {
    if (!l.raw) continue;
    const p = parse(l.raw);
    if (!p) continue;
    const w = score(p);
    if (!Number.isFinite(w)) continue;
    const e = epley1RM(w, p.reps);
    if (e > best) best = e;
  }
  return best;
}
