import { fetchHealthData } from "@features/health/api";
import { getConfig, getEntries, targetsFromConfig } from "@features/nutrition/api";
import { fetchExercises, fetchLogsBySlug, loadStretches } from "@features/training/api";
import { parse, score } from "@features/training/parser";
import { computeStats, epley1RM } from "@features/training/logic";
import { SPLITS } from "@features/training/seed";
import { estimateTdee } from "@features/health/tdee";

export const EXPORT_HEALTH_DAYS = 90;
export const EXPORT_NUTRITION_DAYS = 45;
export const MAX_AI_EXPORT_CHARS = 80_000;

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

  type MetricKey = "weight_kg" | "body_fat_pct" | "active_energy_kcal" | "resting_energy_kcal";
  const METRIC_SPECS: { key: MetricKey; decimals: number }[] = [
    { key: "weight_kg", decimals: 2 },
    { key: "body_fat_pct", decimals: 1 },
    { key: "active_energy_kcal", decimals: 0 },
    { key: "resting_energy_kcal", decimals: 0 },
  ];
  const COPY_KEY: Record<MetricKey, string> = {
    weight_kg: "weight",
    body_fat_pct: "bodyFat",
    active_energy_kcal: "activeEnergy",
    resting_energy_kcal: "restingEnergy",
  };

  const healthSummary: Record<string, unknown> = {};
  for (const spec of METRIC_SPECS) {
    const pts = metrics
      .filter((m) => m[spec.key] != null)
      .map((m) => ({ date: m.metric_date, value: m[spec.key] as number }));
    if (!pts.length) continue;
    const latest = pts.at(-1)!;
    const avg = pts.reduce((s, p) => s + p.value, 0) / pts.length;
    healthSummary[COPY_KEY[spec.key]] = {
      latest: +latest.value.toFixed(spec.decimals),
      latestDate: latest.date,
      changeFromStart: +(latest.value - pts[0].value).toFixed(spec.decimals),
      avg: +avg.toFixed(spec.decimals),
      periodDays: healthDays,
      dataPoints: pts.length,
    };
  }

  const allDates = [...new Set(metrics.map((m) => m.metric_date))].sort();
  const healthTimeline = allDates.map((date) => {
    const row = metrics.find((m) => m.metric_date === date);
    return {
      date,
      weight: row?.weight_kg ?? null,
      bodyFat: row?.body_fat_pct ?? null,
      activeEnergy: row?.active_energy_kcal ?? null,
      restingEnergy: row?.resting_energy_kcal ?? null,
    };
  });

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

  // ── Training ────────────────────────────────────────────────────────────────
  const stretches = loadStretches();

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
        const sliced = allParsed.slice(0, logsPerEx);
        return {
          name: ex.name,
          target: ex.target ?? null,
          note: ex.note ?? null,
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
            note: l.note ?? null,
          })),
        };
      });
      return {
        split: split.name,
        exercises: exerciseData,
        stretches: (stretches[split.id] ?? []).map((s) => ({
          name: s.name,
          note: s.note ?? null,
        })),
      };
    });

  const cutPhase = targets?.cutPhaseName ?? null;
  const inferredGoal =
    cutPhase === "Maintenance" ? "Maintenance" :
    cutPhase != null ? "Fat loss" : null;

  const buildPayload = (logsPerEx: number) => ({
    source: "LiftOS",
    schema: 1.3,
    generatedAt: now.toISOString(),
    units: { weight: "kg", energy: "kcal" },
    profile: {
      height: null,
      trainingAgeMonths: null,
    },
    goals: {
      primary: inferredGoal,
      secondary: "Hypertrophy",
      targetBodyFat: null,
    },
    trainingSchedule: {
      split: "PPL",
      cycle: SPLITS.map((s) => s.name),
    },
    health: {
      tdee: tdeeEst.tdee != null ? Math.round(tdeeEst.tdee) : null,
      tdeeRestingDays: tdeeEst.restingDays,
      tdeeActiveDays: tdeeEst.activeDays,
      latest: {
        weight: (healthSummary.weight as any)?.latest ?? null,
        bodyFat: (healthSummary.bodyFat as any)?.latest ?? null,
        activeEnergy: (healthSummary.activeEnergy as any)?.latest ?? null,
        restingEnergy: (healthSummary.restingEnergy as any)?.latest ?? null,
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

  // Binary search for the largest logsPerEx that fits within MAX_AI_EXPORT_CHARS
  let lo = 1;
  // Upper bound: max logs any exercise has
  let hi = Math.max(1, ...exercises.map((ex) => (allLogsBySlug[ex.slug]?.length ?? 0)));
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
