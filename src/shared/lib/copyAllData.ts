import { fetchHealthData } from "@features/health/api";
import { getConfig, getEntries, targetsFromConfig } from "@features/nutrition/api";
import { monthlyStats, weeklyStats, trainingMonthsFromStart } from "@features/nutrition/logic";
import { getNutritionState } from "@features/nutrition/evaluationApi";
import { fetchExercises, fetchLogsBySlug } from "@features/training/api";
import { parse, score } from "@features/training/parser";
import { computeStats, computeTrend, epley1RM, buildStagnationView } from "@features/training/logic";
import { SPLITS } from "@features/training/seed";
import { estimateTdee } from "@features/health/tdee";
import { computeRecovery } from "@features/health/math";

export const EXPORT_HEALTH_DAYS = 60;
export const EXPORT_NUTRITION_DAYS = 60;
export const MAX_AI_EXPORT_CHARS = 80_000;
// Per-tab "Copy" exports carry the tab's full data (no char budget) — the
// Overview snapshot stays the condensed executive summary. These windows are
// generous so an analysis of a single tab has the complete recent history.
export const FULL_HEALTH_DAYS = 365;
export const FULL_NUTRITION_DAYS = 180;
// Recent training sessions kept per exercise (plus the PR session if it falls
// outside this window) — full history isn't needed for strength analysis.
const MAX_TRAINING_LOGS_PER_EXERCISE = 15;

type MetricKey =
  | "weight_kg" | "body_fat_pct" | "active_energy_kcal" | "resting_energy_kcal"
  | "steps" | "exercise_minutes" | "sleep_seconds" | "resting_heart_rate" | "hrv_sdnn_ms";
const METRIC_SPECS: { key: MetricKey; decimals: number }[] = [
  { key: "weight_kg",           decimals: 2 },
  { key: "body_fat_pct",        decimals: 1 },
  { key: "active_energy_kcal",  decimals: 0 },
  { key: "resting_energy_kcal", decimals: 0 },
  { key: "steps",               decimals: 0 },
  { key: "exercise_minutes",    decimals: 0 },
  { key: "sleep_seconds",       decimals: 0 },
  { key: "resting_heart_rate",  decimals: 0 },
  { key: "hrv_sdnn_ms",         decimals: 1 },
];
const COPY_KEY: Record<MetricKey, string> = {
  weight_kg:           "weight",
  body_fat_pct:        "bodyFat",
  active_energy_kcal:  "activeEnergy",
  resting_energy_kcal: "restingEnergy",
  steps:               "steps",
  exercise_minutes:    "exerciseMinutes",
  sleep_seconds:       "sleepSeconds",
  resting_heart_rate:  "restingHeartRate",
  hrv_sdnn_ms:         "hrv",
};

type BodyMetric = import("@features/health/api").BodyMetric;

/** Per-metric latest / average / change summary over the fetched window. */
function buildHealthSummary(metrics: BodyMetric[], periodDays: number) {
  const summary: Record<string, unknown> = {};
  for (const spec of METRIC_SPECS) {
    const pts = metrics
      .filter((m) => m[spec.key] != null)
      .map((m) => ({ date: m.metric_date, value: m[spec.key] as number }));
    if (!pts.length) continue;
    const latest = pts.at(-1)!;
    const avg = pts.reduce((s, p) => s + p.value, 0) / pts.length;
    summary[COPY_KEY[spec.key]] = {
      latest: +latest.value.toFixed(spec.decimals),
      latestDate: latest.date,
      changeFromStart: +(latest.value - pts[0].value).toFixed(spec.decimals),
      avg: +avg.toFixed(spec.decimals),
      periodDays,
      dataPoints: pts.length,
    };
  }
  return summary;
}

/** One row per date with every metric (null where missing), ascending. */
function buildHealthTimeline(metrics: BodyMetric[]) {
  const allDates = [...new Set(metrics.map((m) => m.metric_date))].sort();
  return allDates.map((date) => {
    const row = metrics.find((m) => m.metric_date === date);
    return {
      date,
      weight:           row?.weight_kg ?? null,
      bodyFat:          row?.body_fat_pct ?? null,
      activeEnergy:     row?.active_energy_kcal ?? null,
      restingEnergy:    row?.resting_energy_kcal ?? null,
      steps:            row?.steps ?? null,
      exerciseMinutes:  row?.exercise_minutes ?? null,
      sleepSeconds:     row?.sleep_seconds ?? null,
      restingHeartRate: row?.resting_heart_rate ?? null,
      hrv:              row?.hrv_sdnn_ms ?? null,
    };
  });
}

export async function buildAllDataJson(healthDays = EXPORT_HEALTH_DAYS, nutritionDays = EXPORT_NUTRITION_DAYS): Promise<string> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nutritionStart = new Date(now.getTime() - nutritionDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [health, nutritionConfig, nutritionEntries, exercises, logsBySlug] = await Promise.all([
    fetchHealthData(healthDays).catch(() => null),
    getConfig().catch(() => null),
    getEntries(nutritionStart, today).catch(() => []),
    fetchExercises().catch(() => []),
    fetchLogsBySlug().catch(() => ({} as Record<string, import("@features/training/api").TrainingLog[]>)),
  ]);

  // ── Health ──────────────────────────────────────────────────────────────────
  const metrics = health?.metrics ?? [];
  const tdeeEst = health?.tdee ?? estimateTdee([], []);
  const recovery = computeRecovery(metrics);

  const healthSummary = buildHealthSummary(metrics, healthDays);
  const healthTimeline = buildHealthTimeline(metrics);

  // ── Nutrition ───────────────────────────────────────────────────────────────
  const targets = nutritionConfig ? targetsFromConfig(nutritionConfig) : null;
  const sortedEntries = [...nutritionEntries].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date),
  );
  const logged = sortedEntries.filter((e) => e.calories != null);
  const avgCalories = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.calories ?? 0), 0) / logged.length)
    : null;
  const avgProtein = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.protein ?? 0), 0) / logged.length)
    : null;

  // 30-day slices for the top-level summary. Canonical "short window" for the
  // recency-weighted numbers (avg cal/protein, weight30d, deficit).
  const SHORT_WINDOW_DAYS = 30;
  const cutoff30 = new Date(now.getTime() - SHORT_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const logged30 = logged.filter((e) => e.entry_date >= cutoff30);
  // When the short window has no data, emit null — NOT the 60d average — so a
  // field named *_30d never silently carries a full-window value.
  const avgCalories30d = logged30.length
    ? Math.round(logged30.reduce((s, e) => s + (e.calories ?? 0), 0) / logged30.length)
    : null;
  const avgProtein30d = logged30.length
    ? Math.round(logged30.reduce((s, e) => s + (e.protein ?? 0), 0) / logged30.length)
    : null;

  const weightPts = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, v: m.weight_kg as number }));
  const currentWeight = weightPts.length ? weightPts.at(-1)!.v : null;
  const weight30dPts = weightPts.filter((p) => p.date >= cutoff30);
  // null (not currentWeight) when the short window is empty — see *_30d note above.
  const weight30d = weight30dPts.length
    ? +( weight30dPts.reduce((s, p) => s + p.v, 0) / weight30dPts.length).toFixed(2)
    : null;

  // daysTracked = distinct dates with a calorie entry in the nutrition window
  const daysTracked = logged.length;

  // deficit summary (only meaningful when TDEE and avg calories are known)
  const tdeeKcal = tdeeEst.tdee != null ? Math.round(tdeeEst.tdee) : null;
  const deficitDaily =
    tdeeKcal != null && avgCalories30d != null ? tdeeKcal - avgCalories30d : null;
  const deficitSummary =
    deficitDaily != null
      ? {
          daily: deficitDaily,
          windowDays: SHORT_WINDOW_DAYS, // deficit is derived from the 30d avg
          // 7700 kcal ≈ 1 kg fat; project over 30 days to get kg/month
          estimatedFatLoss: +((deficitDaily * 30) / 7700).toFixed(2),
        }
      : null;

  // ── Training ────────────────────────────────────────────────────────────────
  // Pre-parse all logs (needed for PR calculation regardless of slice)
  const allLogsBySlug: Record<string, { log: import("@features/training/api").TrainingLog; parsed: ReturnType<typeof parse> | null; w: number | null }[]> = {};
  for (const ex of exercises) {
    const reversed = [...(logsBySlug[ex.slug] ?? [])].reverse();
    allLogsBySlug[ex.slug] = reversed.map((l) => {
      const p = l.raw ? parse(l.raw) : null;
      const w = p ? +score(p).toFixed(2) : null;
      return { log: l, parsed: p, w };
    });
  }

  // ── Insights (pre-computed signals, independent of the export slice) ──────────
  // Weight rate-of-change in kg/week over the full available window (first→last
  // point), NOT the 30d slice used by summary.weight30d. windowDays makes that
  // window explicit so the two weight numbers can't be conflated.
  const weightTrend = (() => {
    const dataPoints = weightPts.length;
    if (dataPoints < 2) return { ratePerWeekKg: null, windowDays: null, dataPoints };
    const first = weightPts[0];
    const last = weightPts.at(-1)!;
    const windowDays = Math.round(
      (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
    );
    if (windowDays < 1) return { ratePerWeekKg: null, windowDays, dataPoints };
    return {
      ratePerWeekKg: +(((last.v - first.v) / windowDays) * 7).toFixed(3),
      windowDays,
      dataPoints,
    };
  })();

  // Nutrition adherence / streak / double-hit over the export window.
  const nutritionAdherence = monthlyStats(
    sortedEntries.map((e) => ({
      date: e.entry_date,
      calories: e.calories,
      protein: e.protein,
      tdee: e.tdee,
      deficitTarget: e.deficit_target,
      proteinTarget: e.protein_target,
    })),
  );

  // Training: flag exercises that are plateauing or declining, with the reason.
  const trainingAttention: {
    name: string;
    status: string;
    retentionPct: number;
    trendPct: number | null;
    reason: string | null;
  }[] = [];
  let improvingCount = 0;
  for (const ex of exercises) {
    if (ex.archived) continue;
    const asc = (allLogsBySlug[ex.slug] ?? []).map((e) => e.log);
    const sv = buildStagnationView(asc);
    if (!sv) continue;
    if (sv.status === "excellent" || sv.status === "on-track") improvingCount++;
    if (sv.status === "watch" || sv.status === "review") {
      trainingAttention.push({
        name: ex.name,
        status: sv.status,
        retentionPct: +(sv.pct * 100).toFixed(1),
        trendPct: sv.t ? +(sv.t.change * 100).toFixed(1) : null,
        reason: sv.reason ?? null,
      });
    }
  }

  const insights = {
    weight: weightTrend,
    nutrition: {
      windowDays: nutritionDays, // adherence/streak/distribution span the full nutrition window (not 30d)
      adherencePct: nutritionAdherence.adherencePct,
      onPlanDays: nutritionAdherence.onPlan,
      loggedDays: nutritionAdherence.logged,
      currentStreak: nutritionAdherence.currentStreak,
      doubleHitCount: nutritionAdherence.doubleHitCount,
      doubleHitPct: nutritionAdherence.doubleHitPct,
      distribution: nutritionAdherence.distribution,
    },
    training: {
      exercisesTracked: improvingCount + trainingAttention.length,
      improvingCount,
      needsAttentionCount: trainingAttention.length,
      attention: trainingAttention,
    },
  };

  const buildTraining = (logsPerEx: number) =>
    SPLITS.map((split) => {
      const splitExercises = exercises.filter(
        (ex) => ex.split === split.id && !ex.archived,
      );
      const exerciseData = splitExercises.map((ex) => {
        const allParsed = allLogsBySlug[ex.slug] ?? [];
        // PR uses all logs; export slice uses the limit
        const allRaw = allParsed.map((e) => e.log);
        const stats = computeStats(allRaw);
        const pr = stats.best?.log.raw ? parse(stats.best.log.raw) : null;

        // Most recent sessions, plus the PR session if it fell outside that window —
        // early-progression logs aren't useful once we have stats + PR.
        const recentCount = Math.min(logsPerEx, MAX_TRAINING_LOGS_PER_EXERCISE);
        const sliced = allParsed.slice(0, recentCount);
        if (stats.best && !sliced.some((e) => e.log.id === stats.best!.log.id)) {
          const prEntry = allParsed.find((e) => e.log.id === stats.best!.log.id);
          if (prEntry) sliced.push(prEntry);
        }

        const trendResult = computeTrend(allRaw);
        const bestE1RM = stats.best ? +stats.best.e1rm.toFixed(1) : null;
        const currentE1RM = stats.latest ? +stats.latest.e1rm.toFixed(1) : null;
        const sessionDates = [...new Set(allRaw.map((l) => l.log_date).filter(Boolean))].sort();
        const lastSession = sessionDates.at(-1) ?? null;

        return {
          name: ex.name,
          target: ex.target ?? null,
          stats: {
            sessions: sessionDates.length,
            bestE1RM,
            currentE1RM,
            trend: trendResult?.trend ?? null,
            trendPct: trendResult ? +((trendResult.change * 100).toFixed(1)) : null,
            lastSession,
          },
          pr: pr
            ? {
                e1rm: +epley1RM(score(pr), pr.reps).toFixed(1),
                bestSet: stats.best?.log.raw ?? null,
              }
            : null,
          logs: sliced.map(({ log: l, parsed: p, w }) => ({
            date: l.log_date,
            raw: l.raw,
            weight: w,
            reps: p?.reps ?? null,
            e1rm: p && w != null ? +epley1RM(w, p.reps).toFixed(1) : null,
          })),
        };
      });
      return {
        split: split.name,
        exercises: exerciseData,
      };
    });

  const cutPhase = targets?.cutPhaseName ?? null;
  const inferredGoal =
    cutPhase === "Maintenance" ? "Maintenance" :
    cutPhase != null ? "Fat loss" : null;

  const buildPayload = (logsPerEx: number) => ({
    source: "LiftOS",
    schema: 2.1,
    summary: {
      currentWeight,
      weight30d,
      avgCalories30d,
      avgProtein30d,
      shortWindowDays: SHORT_WINDOW_DAYS, // window for weight30d / avg*30d / deficit
      tdee: tdeeKcal,
      daysTracked,
      daysTrackedWindowDays: nutritionDays, // daysTracked counts logged days over the full nutrition window
      deficit: deficitSummary,
    },
    insights,
    profile: {
      height: nutritionConfig?.height_cm ?? null,
      trainingAgeMonths: trainingMonthsFromStart(nutritionConfig?.training_start_date),
    },
    goals: {
      primary: inferredGoal,
      secondary: "Hypertrophy",
      targetBodyFat: nutritionConfig?.target_body_fat_pct ?? null,
    },
    trainingSchedule: {
      split: "PPL",
      cycle: SPLITS.map((s) => s.name),
    },
    health: {
      tdee: tdeeEst.tdee != null ? Math.round(tdeeEst.tdee) : null,
      tdeeRestingDays: tdeeEst.restingDays,
      tdeeActiveDays: tdeeEst.activeDays,
      recovery,
      latest: {
        weight:           (healthSummary.weight as any)?.latest ?? null,
        bodyFat:          (healthSummary.bodyFat as any)?.latest ?? null,
        activeEnergy:     (healthSummary.activeEnergy as any)?.latest ?? null,
        restingEnergy:    (healthSummary.restingEnergy as any)?.latest ?? null,
        steps:            (healthSummary.steps as any)?.latest ?? null,
        exerciseMinutes:  (healthSummary.exerciseMinutes as any)?.latest ?? null,
        sleepSeconds:     (healthSummary.sleepSeconds as any)?.latest ?? null,
        restingHeartRate: (healthSummary.restingHeartRate as any)?.latest ?? null,
        hrv:              (healthSummary.hrv as any)?.latest ?? null,
      },
      summary: healthSummary,
      timeline: healthTimeline,
    },
    nutrition: {
      targets: targets
        ? {
            calories: targets.calorieTarget,
            protein: targets.proteinTarget,
            tdee: nutritionConfig?.tdee ?? null,
          }
        : null,
      summary: {
        periodDays: nutritionDays,
        days: sortedEntries.length,
        sampleDays: logged.length,
        avgCalories,
        avgProtein,
      },
      entries: sortedEntries.map((e) => ({
        date: e.entry_date,
        calories: e.calories,
        protein: e.protein,
      })),
    },
    training: buildTraining(logsPerEx),
  });

  // Binary search for the largest logsPerEx that fits within MAX_AI_EXPORT_CHARS,
  // capped at MAX_TRAINING_LOGS_PER_EXERCISE — recent history plus stats/pr is
  // sufficient, so there's no need to search beyond that.
  let lo = 1;
  const maxLogsAnyExercise = Math.max(0, ...exercises.map((ex) => (allLogsBySlug[ex.slug]?.length ?? 0)));
  let hi = Math.max(1, Math.min(MAX_TRAINING_LOGS_PER_EXERCISE, maxLogsAnyExercise));
  let result = JSON.stringify(buildPayload(lo), null, 2);

  if (JSON.stringify(buildPayload(hi), null, 2).length <= MAX_AI_EXPORT_CHARS) {
    // Full data fits — return everything
    return JSON.stringify(buildPayload(hi), null, 2);
  }

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const json = JSON.stringify(buildPayload(mid), null, 2);
    if (json.length <= MAX_AI_EXPORT_CHARS) {
      result = json;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

// ── Per-tab full exports ──────────────────────────────────────────────────────
// Each tab's Copy button emits a standalone JSON of just that tab's complete
// data — no char budget, no truncation. Overview (buildAllDataJson) stays the
// condensed cross-tab snapshot. Paste Overview first, then a tab for depth.

/** Health tab: full metric timeline, per-metric summary, recovery + baselines, TDEE. */
export async function buildHealthJson(days = FULL_HEALTH_DAYS): Promise<string> {
  const health = await fetchHealthData(days).catch(() => null);
  const metrics = health?.metrics ?? [];
  const tdeeEst = health?.tdee ?? estimateTdee([], []);

  const payload = {
    source: "LiftOS",
    schema: 2.1,
    tab: "health",
    windowDays: days,
    tdee: {
      tdee: tdeeEst.tdee != null ? Math.round(tdeeEst.tdee) : null,
      restingDays: tdeeEst.restingDays,
      activeDays: tdeeEst.activeDays,
    },
    recovery: computeRecovery(metrics),
    summary: buildHealthSummary(metrics, days),
    timeline: buildHealthTimeline(metrics),
  };
  return JSON.stringify(payload, null, 2);
}

/** Nutrition tab: targets, persisted evaluation, adherence stats, full entries. */
export async function buildNutritionJson(days = FULL_NUTRITION_DAYS): Promise<string> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  const [config, entries, state] = await Promise.all([
    getConfig().catch(() => null),
    getEntries(start, today).catch(() => []),
    getNutritionState().catch(() => null),
  ]);

  const targets = config ? targetsFromConfig(config) : null;
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const logged = sorted.filter((e) => e.calories != null);
  const avgCalories = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.calories ?? 0), 0) / logged.length)
    : null;
  const avgProtein = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.protein ?? 0), 0) / logged.length)
    : null;

  const dayInputs = sorted.map((e) => ({
    date: e.entry_date,
    calories: e.calories,
    protein: e.protein,
    tdee: e.tdee,
    deficitTarget: e.deficit_target,
    proteinTarget: e.protein_target,
  }));
  const adherence = monthlyStats(dayInputs);

  const payload = {
    source: "LiftOS",
    schema: 2.1,
    tab: "nutrition",
    windowDays: days,
    targets: targets
      ? {
          calories: targets.calorieTarget,
          protein: targets.proteinTarget,
          deficitTarget: targets.deficitTarget,
          cutPhase: targets.cutPhaseName,
          tdee: config?.tdee ?? null,
        }
      : null,
    evaluation: state,
    summary: {
      periodDays: days,
      days: sorted.length,
      sampleDays: logged.length,
      avgCalories,
      avgProtein,
    },
    adherence: {
      adherencePct: adherence.adherencePct,
      onPlanDays: adherence.onPlan,
      loggedDays: adherence.logged,
      currentStreak: adherence.currentStreak,
      doubleHitCount: adherence.doubleHitCount,
      doubleHitPct: adherence.doubleHitPct,
      distribution: adherence.distribution,
    },
    weekly: weeklyStats(dayInputs),
    entries: sorted.map((e) => ({
      date: e.entry_date,
      calories: e.calories,
      protein: e.protein,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/** Training tab: every active exercise per split with full log history, PR, stats, trend. */
export async function buildTrainingJson(): Promise<string> {
  const [exercises, logsBySlug] = await Promise.all([
    fetchExercises().catch(() => []),
    fetchLogsBySlug().catch(
      () => ({}) as Record<string, import("@features/training/api").TrainingLog[]>,
    ),
  ]);

  const splits = SPLITS.map((split) => {
    const splitExercises = exercises.filter((ex) => ex.split === split.id && !ex.archived);
    const exerciseData = splitExercises.map((ex) => {
      // fetchLogsBySlug is newest-first; reverse to ascending for stats/trend/logs.
      const ascLogs = [...(logsBySlug[ex.slug] ?? [])].reverse();
      const stats = computeStats(ascLogs);
      const pr = stats.best?.log.raw ? parse(stats.best.log.raw) : null;
      const trendResult = computeTrend(ascLogs);
      const sv = buildStagnationView(ascLogs);
      const sessionDates = [...new Set(ascLogs.map((l) => l.log_date).filter(Boolean))].sort();

      return {
        name: ex.name,
        target: ex.target ?? null,
        stats: {
          sessions: sessionDates.length,
          bestE1RM: stats.best ? +stats.best.e1rm.toFixed(1) : null,
          currentE1RM: stats.latest ? +stats.latest.e1rm.toFixed(1) : null,
          trend: trendResult?.trend ?? null,
          trendPct: trendResult ? +(trendResult.change * 100).toFixed(1) : null,
          lastSession: sessionDates.at(-1) ?? null,
        },
        pr: pr
          ? {
              e1rm: +epley1RM(score(pr), pr.reps).toFixed(1),
              bestSet: stats.best?.log.raw ?? null,
            }
          : null,
        stagnation: sv
          ? {
              status: sv.status,
              retentionPct: +(sv.pct * 100).toFixed(1),
              reason: sv.reason ?? null,
            }
          : null,
        logs: ascLogs.map((l) => {
          const p = l.raw ? parse(l.raw) : null;
          const w = p ? +score(p).toFixed(2) : null;
          return {
            date: l.log_date,
            raw: l.raw,
            weight: w,
            reps: p?.reps ?? null,
            e1rm: p && w != null ? +epley1RM(w, p.reps).toFixed(1) : null,
          };
        }),
      };
    });
    return { split: split.name, exercises: exerciseData };
  });

  const payload = {
    source: "LiftOS",
    schema: 2.1,
    tab: "training",
    schedule: { split: "PPL", cycle: SPLITS.map((s) => s.name) },
    splits,
  };
  return JSON.stringify(payload, null, 2);
}
