import { fetchHealthData } from "@features/health/api";
import { getConfig, getEntries, targetsFromConfig, type NutritionEntry } from "@features/nutrition/api";
import { monthlyStats, weeklyStats, trainingMonthsFromStart, phaseFromDeficit } from "@features/nutrition/logic";
import { getNutritionState, windowedLoggedIntake, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import { weeklyWeightRate, tdeeCalibration, confidenceBreakdownFromSeries, MIN_TREND_POINTS, type TdeeCalibration, type ConfidenceBreakdown } from "@features/nutrition/evaluation";
import { nutritionDecision } from "@features/nutrition/recommendation";
import { fetchExercises, fetchLogsBySlug } from "@features/training/api";
import { parse, score } from "@features/training/parser";
import { computeStats, epley1RM, maxReps } from "@features/training/logic";
import { computeStrengthSummary, type StrengthExercise } from "@features/overview/api";
import { inferMuscleGroup } from "@features/training/muscleGroup";
import { computeMuscleClusters, suggestClusterFatigue } from "@features/training/muscleCluster";
import { defaultSetCount } from "@features/training/logFormHelpers";
import { SPLITS } from "@features/training/seed";
import { estimateTdee } from "@features/health/tdee";
import { computeRecovery, sanitizeMetrics } from "@features/health/math";

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
  | "exercise_minutes" | "sleep_seconds" | "resting_heart_rate" | "hrv_sdnn_ms";
const METRIC_SPECS: { key: MetricKey; decimals: number }[] = [
  { key: "weight_kg",           decimals: 2 },
  { key: "body_fat_pct",        decimals: 1 },
  { key: "active_energy_kcal",  decimals: 0 },
  { key: "resting_energy_kcal", decimals: 0 },
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
  exercise_minutes:    "exerciseMinutes",
  sleep_seconds:       "sleepSeconds",
  resting_heart_rate:  "restingHeartRate",
  hrv_sdnn_ms:         "hrv",
};

type BodyMetric = import("@features/health/api").BodyMetric;

// Unit legend — emitted at the top of each export so an LLM never has to guess
// kg vs lb, kcal, ms, bpm, etc. Each export includes only the keys it uses.
const UNIT: Record<string, string> = {
  weight: "kg",
  bodyFat: "%",
  leanMass: "kg",
  activeEnergy: "kcal",
  restingEnergy: "kcal",
  exerciseMinutes: "min",
  sleepSeconds: "s",
  restingHeartRate: "bpm",
  hrv: "ms",
  tdee: "kcal",
  calories: "kcal",
  protein: "g",
  height: "cm",
  e1rm: "kg",
  volume: "kg·reps", // best-set tonnage (weight × reps) — the isolation score axis
};
function unitsFor(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (UNIT[k]) out[k] = UNIT[k];
  return out;
}
const HEALTH_UNIT_KEYS = [...Object.values(COPY_KEY), "tdee"];
const NUTRITION_UNIT_KEYS = ["calories", "protein", "tdee"];
const TRAINING_UNIT_KEYS = ["weight", "e1rm", "volume"];
const OVERVIEW_UNIT_KEYS = [...HEALTH_UNIT_KEYS, "calories", "protein", "e1rm", "volume", "height"];

// computeRecovery returns raw rolling averages (many decimals). Round at the
// export boundary — the UI keeps the full-precision source for its own
// formatting, but the JSON shouldn't carry 15-digit float noise.
function roundRecovery(r: ReturnType<typeof computeRecovery>) {
  const d1 = (v: number | null) => (v == null ? null : +v.toFixed(1));
  const band = (b: { lo: number; hi: number } | null) =>
    b == null ? null : { lo: +b.lo.toFixed(1), hi: +b.hi.toFixed(1) };
  return {
    ...r,
    sleepHours: d1(r.sleepHours),
    sleepBaseline: d1(r.sleepBaseline),
    sleepBand: band(r.sleepBand),
    hrv: d1(r.hrv),
    hrvBaseline: d1(r.hrvBaseline),
    hrvBand: band(r.hrvBand),
    rhr: r.rhr == null ? null : Math.round(r.rhr),
    rhrBaseline: d1(r.rhrBaseline),
    rhrBand: band(r.rhrBand),
  };
}

/** Actual data span so the LLM doesn't have to infer it from the rows.
 *  `days` is the calendar gap between the first and last dated record. */
function windowOf(dates: (string | null | undefined)[]): { from: string; to: string; days: number } | null {
  const valid = dates.filter((d): d is string => !!d).sort();
  if (!valid.length) return null;
  const from = valid[0];
  const to = valid[valid.length - 1];
  return { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) };
}

/** Monday (local) of the week a YYYY-MM-DD date falls in, as YYYY-MM-DD. */
function weekStartMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Target-phase history reconstructed from the entries themselves. Every
 *  nutrition entry snapshots the calorie/protein target that was active the day
 *  it was logged (saveEntry writes targetsFromConfig), so the full target
 *  timeline lives in the data — no separate audit table needed. A new phase
 *  begins whenever calorie_target or protein_target changes from the previous
 *  logged day. This lets an analysis attribute each day's intake to the goal
 *  actually in force at the time: a 2452 kcal day under a 2050 target is on
 *  plan, NOT overeating against today's 1750 target. Without this the reader
 *  sees only the current target and mistakes every historical over-target day
 *  for a slip. */
function buildTargetPhases(entries: NutritionEntry[]) {
  const withTarget = [...entries]
    .filter((e) => e.calorie_target != null)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  type Acc = {
    from: string; to: string;
    calorieTarget: number; proteinTarget: number | null;
    deficitTarget: number | null; tdee: number | null;
    calSum: number; calN: number; protSum: number; protN: number;
  };
  const accs: Acc[] = [];
  for (const e of withTarget) {
    const cal = e.calorie_target as number;
    const prot = e.protein_target;
    const last = accs.at(-1);
    // New phase when the effective target (calories or protein) changes.
    if (!last || last.calorieTarget !== cal || last.proteinTarget !== prot) {
      accs.push({
        from: e.entry_date, to: e.entry_date,
        calorieTarget: cal, proteinTarget: prot,
        deficitTarget: e.deficit_target, tdee: e.tdee,
        calSum: 0, calN: 0, protSum: 0, protN: 0,
      });
    }
    const acc = accs.at(-1)!;
    acc.to = e.entry_date;
    if (e.calories != null) { acc.calSum += e.calories; acc.calN++; }
    if (e.protein != null) { acc.protSum += e.protein; acc.protN++; }
  }

  return accs.map((a) => ({
    from: a.from,
    to: a.to,
    // activeDays = inclusive calendar span of the phase; loggedDays = how many
    // of those days actually have an entry (the rest are gaps, not misses).
    activeDays: Math.round((Date.parse(a.to) - Date.parse(a.from)) / 86_400_000) + 1,
    loggedDays: a.calN,
    calorieTarget: a.calorieTarget,
    proteinTarget: a.proteinTarget,
    deficitTarget: a.deficitTarget,
    tdee: a.tdee,
    cutPhase: a.deficitTarget != null ? phaseFromDeficit(a.deficitTarget) : null,
    avgCalories: a.calN ? Math.round(a.calSum / a.calN) : null,
    avgProtein: a.protN ? Math.round(a.protSum / a.protN) : null,
  }));
}

/** Start date of the phase matching the current config target — i.e. how long
 *  today's target has been in force. Null when the current target differs from
 *  the last logged phase (target changed but not yet logged against), so the
 *  field never claims an activeSince the data can't back up. */
function activeSinceFor(
  phases: ReturnType<typeof buildTargetPhases>,
  currentCalorieTarget: number | null | undefined,
): string | null {
  const last = phases.at(-1);
  return last && currentCalorieTarget != null && last.calorieTarget === currentCalorieTarget
    ? last.from
    : null;
}

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
      // How much of the window actually has readings. A high `latest`/`avg` on
      // low coverage (e.g. body fat measured 6 of 60 days, or an active-energy
      // reading from a still-incomplete today) is weak — surfacing the density
      // lets a reader weight it instead of trusting a sparse number as solid.
      coveragePct: Math.round((pts.length / periodDays) * 100),
    };
  }
  return summary;
}

/** Columnar timeline: `dates` plus one aligned array per metric (null where a
 *  metric is missing for a date), ascending. Columnar over array-of-objects
 *  because it drops ~40% of the tokens (no repeated keys) and an LLM parses it
 *  just as reliably. */
function buildHealthTimeline(metrics: BodyMetric[]) {
  const dates = [...new Set(metrics.map((m) => m.metric_date))].sort();
  const byDate = new Map(metrics.map((m) => [m.metric_date, m]));
  const col = (pick: (m: BodyMetric) => number | null) =>
    dates.map((d) => pick(byDate.get(d)!) ?? null);
  return {
    dates,
    weight:           col((m) => m.weight_kg),
    bodyFat:          col((m) => m.body_fat_pct),
    activeEnergy:     col((m) => m.active_energy_kcal),
    restingEnergy:    col((m) => m.resting_energy_kcal),
    exerciseMinutes:  col((m) => m.exercise_minutes),
    sleepSeconds:     col((m) => m.sleep_seconds),
    restingHeartRate: col((m) => m.resting_heart_rate),
    hrv:              col((m) => m.hrv_sdnn_ms),
  };
}

export async function buildAllDataJson(healthDays = EXPORT_HEALTH_DAYS, nutritionDays = EXPORT_NUTRITION_DAYS): Promise<string> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // −(nutritionDays − 1): getEntries is inclusive of both ends, so subtracting
  // the full nutritionDays would span nutritionDays+1 calendar days and make
  // `days`/`sampleDays` read one higher than the stated `periodDays`.
  const nutritionStart = new Date(now.getTime() - (nutritionDays - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [health, nutritionConfig, nutritionEntries, nutritionStateFull, exercises, logsBySlug] = await Promise.all([
    fetchHealthData(healthDays).catch(() => null),
    getConfig().catch(() => null),
    getEntries(nutritionStart, today).catch(() => []),
    getNutritionState().catch(() => null),
    fetchExercises().catch(() => []),
    fetchLogsBySlug().catch(() => ({} as Record<string, import("@features/training/api").TrainingLog[]>)),
  ]);

  // ── Health ──────────────────────────────────────────────────────────────────
  // Sanitize first: implausible body-fat samples become null, exactly as the
  // Health tab does — so summary/timeline/trend never carry a value the UI hides.
  const metrics = sanitizeMetrics(health?.metrics ?? []);
  const tdeeEst = health?.tdee ?? estimateTdee([], []);
  const recovery = roundRecovery(computeRecovery(metrics));

  const healthSummary = buildHealthSummary(metrics, healthDays);
  const healthTimeline = buildHealthTimeline(metrics);

  // ── Nutrition ───────────────────────────────────────────────────────────────
  const targets = nutritionConfig ? targetsFromConfig(nutritionConfig) : null;
  const sortedEntries = [...nutritionEntries].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date),
  );
  const nutritionPhases = buildTargetPhases(sortedEntries);
  // TDEE calibration + confidence breakdown (inform-only) — mirrors
  // buildNutritionJson so the full-data export and the nutrition-tab export can
  // never disagree.
  const nutritionLoggedIntake = windowedLoggedIntake(sortedEntries);
  const nutritionIntakeGap =
    nutritionStateFull && nutritionLoggedIntake != null
      ? nutritionStateFull.diagnostics.estimatedIntake - Math.round(nutritionLoggedIntake)
      : null;
  const nutritionCalibration: TdeeCalibration | null =
    nutritionConfig && nutritionStateFull
      ? tdeeCalibration({
          assumedTdee: nutritionConfig.tdee,
          estimatedTdee: nutritionStateFull.diagnostics.estimatedTdee,
          loggedIntake: nutritionLoggedIntake,
          observedRate: nutritionStateFull.evaluation.observedRate,
          weightTrustworthy:
            nutritionStateFull.diagnostics.weightDataPoints >= MIN_TREND_POINTS &&
            nutritionStateFull.evaluation.confidence !== "low",
        })
      : null;
  const nutritionWeightSeries = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));
  const nutritionConfidence: ConfidenceBreakdown | null =
    nutritionStateFull && nutritionWeightSeries.length
      ? confidenceBreakdownFromSeries(
          nutritionWeightSeries,
          nutritionStateFull.diagnostics.daysOnTarget,
          nutritionIntakeGap,
        )
      : null;
  const nutritionEngine = engineHypothesis(
    nutritionStateFull,
    nutritionCalibration,
    nutritionConfidence,
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
  // Reuse health.summary's own "latest weight" rather than re-deriving it —
  // same metrics array, same "latest" concept, one computation.
  const currentWeight = (healthSummary.weight as { latest: number } | undefined)?.latest ?? null;
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
  // Weight rate-of-change in kg/week. Uses the SAME helper (weeklyWeightRate →
  // theilSenSlope over the trailing 21 days) that produces the UI's "Trend"
  // number, so the export and the app can never report different rates. See
  // summary.weight30d for the separate 30d average level — that's a different
  // question (where am I now) and carries its own windowDays.
  const weightTrend = weeklyWeightRate(
    weightPts.map((p) => ({ date: p.date, value: p.v })),
  );

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

  // Training: flag exercises sitting below PR ("watch"), with weeks-since-PR.
  // Status is PR-distance (latest ÷ PR), the SAME model the Training Health card
  // uses — this user logs asymmetrically (only drops/PRs, maintenance goes
  // unrecorded), so a session-to-session slope reads that biased sample as
  // decline. Judging distance-from-PR keeps the export in step with the UI.
  const strengthBySlug = new Map<string, StrengthExercise>(
    computeStrengthSummary(
      Object.fromEntries(
        exercises
          .filter((e) => !e.archived)
          .map((e) => [e.slug, (allLogsBySlug[e.slug] ?? []).map((x) => x.log)]),
      ),
      new Set(exercises.filter((e) => e.compound).map((e) => e.slug)),
    ).exercises.map((x) => [x.slug, x]),
  );
  const nameBySlug = new Map(exercises.map((e) => [e.slug, e.name]));
  const trainingAttention = [...strengthBySlug.values()]
    .filter((x) => x.needsAttention)
    .sort((a, b) => a.trend - b.trend) // worst (furthest below PR) first
    .map((x) => ({
      name: nameBySlug.get(x.slug) ?? x.name,
      status: x.status,
      retentionPct: +(x.trend * 100).toFixed(1),
      weeksSincePR: x.stalledWeeks,
    }));
  const improvingCount = [...strengthBySlug.values()].filter((x) => !x.needsAttention).length;

  // Muscle-cluster fatigue: several lifts of one primary muscle sliding together
  // in the same block — a systemic signal a per-lift read can't see. Riding on
  // trajectory; muscle inferred from name/slug/split (no DB column). Only the
  // flagged (systemic) groups are surfaced, each with its muscle-level action.
  const splitBySlug = new Map(exercises.map((e) => [e.slug, e.split]));
  const muscleFatigue = computeMuscleClusters(
    [...strengthBySlug.values()],
    (x) => inferMuscleGroup(x.name, x.slug, splitBySlug.get(x.slug)),
  )
    .map((c) => suggestClusterFatigue(c, (s) => nameBySlug.get(s) ?? s))
    .filter((a): a is NonNullable<typeof a> => a !== null);

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
      // Muscle-level fatigue clusters (systemic only) — empty when nothing lines up.
      muscleFatigue,
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
        const setCount = defaultSetCount(ex);
        const stats = computeStats(allRaw, setCount, ex.compound ? "compound" : "isolation");

        // allParsed is ascending (oldest→newest); take the tail for the most
        // recent sessions, plus the PR session if it fell outside that window —
        // early-progression logs aren't useful once we have stats + PR.
        const recentCount = Math.min(logsPerEx, MAX_TRAINING_LOGS_PER_EXERCISE);
        const sliced = allParsed.slice(-recentCount);
        if (stats.best && !sliced.some((e) => e.log.id === stats.best!.log.id)) {
          const prEntry = allParsed.find((e) => e.log.id === stats.best!.log.id);
          if (prEntry) sliced.push(prEntry);
        }
        // Keep chronological order even when an out-of-window PR was appended.
        sliced.sort((a, b) => (a.log.log_date ?? "").localeCompare(b.log.log_date ?? ""));

        const se = strengthBySlug.get(ex.slug);
        // `metric` names the scoring axis (compound → e1RM, isolation → best-set
        // tonnage/volume), so stats.best/current are generic — the reader keys off
        // `metric` for the unit. Volume is a kg·reps product, never lb-converted.
        // (schema 2.7)
        const isVol = !ex.compound;
        const scoreVal = (s: (typeof stats)["best"]) =>
          s ? +(isVol ? s.tonnage : s.e1rm).toFixed(1) : null;
        const sessionDates = [...new Set(allRaw.map((l) => l.log_date).filter(Boolean))].sort();
        const lastSession = sessionDates.at(-1) ?? null;

        return {
          name: ex.name,
          // Stable identifier — set at creation, never changes if the exercise is
          // renamed. Use this (not `name`) to track an exercise across edits.
          slug: ex.slug,
          target: ex.target ?? null,
          // Primary (scoring) metric — which axis retention/status/PR reference,
          // NOT the only one computable (e1RM still exists for isolation lifts).
          metric: isVol ? "volume" : "e1rm",
          stats: {
            sessions: sessionDates.length,
            best: scoreVal(stats.best),
            current: scoreVal(stats.latest),
            // PR-distance model (see strengthBySlug above): retention = latest ÷ PR.
            // status is the settled verdict (improving/stable/watch). weeksSincePR is
            // dropped — derivable from pr.date + lastSession.
            retentionPct: se ? +(se.trend * 100).toFixed(1) : null,
            status: se ? se.status : null,
            // Trend layer: which way / how fast / how trustworthy the recent
            // window reads — separate from retention (distance-from-PR).
            trajectory: se ? se.trajectory : null,
            lastSession,
          },
          // The PR number equals stats.best, so pr carries only what's unique: the
          // date and the exact set. bestSet is canonical (parser rebuilds weight/reps).
          pr: stats.best
            ? { date: stats.best.log.log_date ?? null, bestSet: stats.best.log.raw ?? null }
            : null,
          logs: sliced.map(({ log: l, parsed: p, w }) => ({
            id: l.id,
            date: l.log_date,
            raw: l.raw,
            weight: w,
            reps: p?.reps ?? null,
            ...(isVol
              ? { volume: p && w != null ? +(w * maxReps(p.reps)).toFixed(1) : null }
              : { e1rm: p && w != null ? +epley1RM(w, p.reps).toFixed(1) : null }),
          })),
        };
      });
      return {
        split: split.name,
        // exercises appear in the user's own display order (drag/move-up-down in Training tab), not alphabetical.
        exercisesOrder: "user-defined display order",
        exercises: exerciseData,
      };
    });

  const cutPhase = targets?.cutPhaseName ?? null;
  const inferredGoal =
    cutPhase === "Maintenance" ? "Maintenance" :
    cutPhase != null ? "Fat loss" : null;

  // Same as buildTrainingJson: dataSpan must reflect only the active exercises
  // we actually emit, so an archived lift's log dates don't skew the window.
  const activeSlugs = new Set(exercises.filter((e) => !e.archived).map((e) => e.slug));
  const overviewWindow = windowOf([
    ...metrics.map((m) => m.metric_date),
    ...sortedEntries.map((e) => e.entry_date),
    ...Object.entries(logsBySlug)
      .filter(([slug]) => activeSlugs.has(slug))
      .flatMap(([, logs]) => logs)
      .map((l) => l.log_date),
  ]);

  const buildPayload = (logsPerEx: number) => ({
    source: "LiftOS",
    schema: 2.9,
    units: unitsFor(OVERVIEW_UNIT_KEYS),
    dataSpan: overviewWindow, // total span of ALL data (see windowOf); distinct from per-section windowDays
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
      // TDEE value lives once in summary.tdee (the executive number); these two
      // only say how many days fed that estimate. And there's no separate
      // `latest` block — each metric's latest already lives in `summary` (its
      // `.latest` field), so grouping them again just duplicated nine values.
      tdeeRestingDays: tdeeEst.restingDays,
      tdeeActiveDays: tdeeEst.activeDays,
      recovery,
      summary: healthSummary,
      timeline: healthTimeline,
    },
    nutrition: {
      targets: targets
        ? {
            calories: targets.calorieTarget,
            protein: targets.proteinTarget,
            tdee: nutritionConfig?.tdee ?? null,
            // How long today's target has been running (see activeSinceFor).
            activeSince: activeSinceFor(nutritionPhases, targets.calorieTarget),
          }
        : null,
      // Target-phase timeline: which calorie/protein goal was in force over
      // which dates, so an over-target day is judged against the goal of its
      // day — not today's. See buildTargetPhases.
      phases: nutritionPhases,
      engine: nutritionEngine,
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
  const metrics = sanitizeMetrics(health?.metrics ?? []);
  const tdeeEst = health?.tdee ?? estimateTdee([], []);

  const payload = {
    source: "LiftOS",
    schema: 2.8,
    tab: "health",
    units: unitsFor(HEALTH_UNIT_KEYS),
    dataSpan: windowOf(metrics.map((m) => m.metric_date)),
    windowDays: days,
    tdee: {
      tdee: tdeeEst.tdee != null ? Math.round(tdeeEst.tdee) : null,
      restingDays: tdeeEst.restingDays,
      activeDays: tdeeEst.activeDays,
    },
    recovery: roundRecovery(computeRecovery(metrics)),
    summary: buildHealthSummary(metrics, days),
    timeline: buildHealthTimeline(metrics),
  };
  return JSON.stringify(payload, null, 2);
}

/** The nutrition engine's read, shaped for audit rather than obedience: the
 *  evaluation (reality), the diagnostics that set its confidence, and the
 *  decision those rules produced — labelled a hypothesis, not ground truth, so a
 *  reviewing LLM challenges it against the facts instead of deferring to a
 *  one-liner. Every field comes straight from the engine; nothing is authored
 *  here. nutritionDecision reads only persisted fields, so it matches the app. */
function engineHypothesis(
  state: NutritionStateFull | null,
  calibration: TdeeCalibration | null,
  confidence: ConfidenceBreakdown | null,
) {
  if (!state) return null;
  const d = nutritionDecision(state.evaluation, state.diagnostics);
  // Discrete labels for the rules that actually fired, so a reviewer sees
  // *which* rules produced the hypothesis instead of re-deriving them from
  // the raw evaluation/diagnostics/calibration/decision fields below.
  const rulesTriggered: string[] = [
    `rate_${state.evaluation.status}`,
    `confidence_${state.evaluation.confidence}`,
    `decision_${d.action}`,
  ];
  if (calibration) rulesTriggered.push(`tdee_${calibration.status}`);
  if (state.diagnostics.intakeGap != null) {
    rulesTriggered.push(state.diagnostics.intakeGap > 0 ? "intake_above_estimate" : "intake_below_estimate");
  }
  return {
    engine: "LiftOS",
    version: 2.8,
    note: "LiftOS's current hypothesis from its own rules — audit it against the data above; don't assume it's correct.",
    rulesTriggered,
    evaluation: state.evaluation,
    // The inputs behind evaluation.confidence, so a reviewer can re-derive (or
    // dispute) it rather than take the label at face value.
    diagnostics: state.diagnostics,
    // The label on `evaluation.confidence` is the gate; this decomposes it into the
    // continuous per-source signals it collapses (freshness / weightData / trend /
    // intake) plus which hard cap held it down — so a reviewer weighs the reasons,
    // not just the word. `label` here always equals `evaluation.confidence`.
    confidence,
    // Inform-only cross-check: is the TDEE the target is built on still consistent
    // with measured burn AND the food-log/weight-implied TDEE? Claims "under"/"over"
    // only when both independent sources corroborate. null = not enough to judge.
    // Never proposes a calorie change — the reader decides.
    tdeeCalibration: calibration,
    decision: {
      action: d.action,
      headline: d.actionHeadline,
      reason: d.reason,
      currentTarget: d.currentTarget,
      proposedTarget: d.proposedTarget,
    },
  };
}

/** Nutrition tab: targets, engine hypothesis, adherence stats, full entries. */
export async function buildNutritionJson(days = FULL_NUTRITION_DAYS): Promise<string> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // −(days − 1): getEntries is inclusive both ends (see buildAllDataJson).
  const start = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const [config, entries, state, health] = await Promise.all([
    getConfig().catch(() => null),
    getEntries(start, today).catch(() => []),
    getNutritionState().catch(() => null),
    // Weight series — needed to decompose confidence (scatter/gap aren't persisted).
    fetchHealthData(90).catch(() => null),
  ]);

  const targets = config ? targetsFromConfig(config) : null;
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const phases = buildTargetPhases(sorted);
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

  // Real week-by-week series (Monday-anchored) so an LLM can see the diet
  // trend — the old single `weekly` aggregate hid it behind one number.
  const byWeek = new Map<string, typeof dayInputs>();
  for (const d of dayInputs) {
    const wk = weekStartMonday(d.date);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(d);
  }
  const weekly = [...byWeek.keys()].sort().map((wk) => ({
    weekStart: wk,
    ...weeklyStats(byWeek.get(wk)!),
  }));

  // loggedIntake / intakeGap reuse the engine's own windowed mean and diagnostics
  // so the export never re-derives them differently from the app.
  const loggedIntake = windowedLoggedIntake(sorted);
  const intakeGap =
    state && loggedIntake != null ? state.diagnostics.estimatedIntake - Math.round(loggedIntake) : null;

  // TDEE calibration cross-check (inform-only): compare the TDEE the target is
  // built on (config.tdee) against measured burn + the log/weight-implied TDEE.
  const calibration: TdeeCalibration | null =
    config && state
      ? tdeeCalibration({
          assumedTdee: config.tdee,
          estimatedTdee: state.diagnostics.estimatedTdee,
          loggedIntake,
          observedRate: state.evaluation.observedRate,
          weightTrustworthy:
            state.diagnostics.weightDataPoints >= MIN_TREND_POINTS &&
            state.evaluation.confidence !== "low",
        })
      : null;

  // Confidence breakdown — recomputed from the weight series (scatter/gap aren't
  // persisted). Its `label` matches the persisted evaluation.confidence.
  const weightSeries = (health?.metrics ?? [])
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));
  const confidence: ConfidenceBreakdown | null =
    state && weightSeries.length
      ? confidenceBreakdownFromSeries(weightSeries, state.diagnostics.daysOnTarget, intakeGap)
      : null;

  const payload = {
    source: "LiftOS",
    schema: 2.8,
    tab: "nutrition",
    units: unitsFor(NUTRITION_UNIT_KEYS),
    dataSpan: windowOf(sorted.map((e) => e.entry_date)),
    windowDays: days,
    targets: targets
      ? {
          calories: targets.calorieTarget,
          protein: targets.proteinTarget,
          deficitTarget: targets.deficitTarget,
          cutPhase: targets.cutPhaseName,
          tdee: config?.tdee ?? null,
          activeSince: activeSinceFor(phases, targets.calorieTarget),
        }
      : null,
    // Target-phase timeline reconstructed from each day's snapshotted target —
    // which calorie/protein goal was in force over which dates. See
    // buildTargetPhases: judge each day's intake against its day's target.
    phases,
    engine: engineHypothesis(state, calibration, confidence),
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
    weekly,
    entries: sorted.map((e) => ({
      date: e.entry_date,
      calories: e.calories,
      protein: e.protein,
      // Per-day snapshot of the target in force when this day was logged, so a
      // reader never has to infer it from `phases` — the raw truth is inline.
      calorieTarget: e.calorie_target,
      proteinTarget: e.protein_target,
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

  // PR-distance status per exercise (same model as the Training Health card).
  const strengthBySlug = new Map<string, StrengthExercise>(
    computeStrengthSummary(
      Object.fromEntries(
        exercises.filter((e) => !e.archived).map((e) => [e.slug, logsBySlug[e.slug] ?? []]),
      ),
      new Set(exercises.filter((e) => e.compound).map((e) => e.slug)),
    ).exercises.map((x) => [x.slug, x]),
  );

  // Slugs of exercises that survive the archived filter — dataSpan below must
  // measure only the same active exercises we actually emit, otherwise an
  // archived lift's oldest/newest log would skew the reported window.
  const activeSlugs = new Set(exercises.filter((e) => !e.archived).map((e) => e.slug));

  const splits = SPLITS.map((split) => {
    const splitExercises = exercises.filter((ex) => ex.split === split.id && !ex.archived);
    const exerciseData = splitExercises.map((ex) => {
      // fetchLogsBySlug is newest-first; reverse to ascending for stats/logs.
      const ascLogs = [...(logsBySlug[ex.slug] ?? [])].reverse();
      const setCount = defaultSetCount(ex);
      const stats = computeStats(ascLogs, setCount, ex.compound ? "compound" : "isolation");
      const se = strengthBySlug.get(ex.slug);
      const sessionDates = [...new Set(ascLogs.map((l) => l.log_date).filter(Boolean))].sort();

      // `metric` names the scoring axis (compound → e1RM, isolation → volume), so
      // stats.best/current are generic and the reader keys off `metric` for the
      // unit. status folds in from the old `strength` block (which just duplicated
      // stats); weeksSincePR is dropped — derive from pr.date + lastSession.
      // (schema 2.7 — mirrors buildAllDataJson.)
      const isVol = !ex.compound;
      const scoreVal = (s: (typeof stats)["best"]) =>
        s ? +(isVol ? s.tonnage : s.e1rm).toFixed(1) : null;

      return {
        name: ex.name,
        // Stable identifier — set at creation, never changes if the exercise is
        // renamed. Use this (not `name`) to track an exercise across edits.
        slug: ex.slug,
        target: ex.target ?? null,
        // Primary (scoring) metric — the axis retention/status/PR reference,
        // NOT the only one computable (e1RM still exists for isolation lifts).
        metric: isVol ? "volume" : "e1rm",
        stats: {
          sessions: sessionDates.length,
          best: scoreVal(stats.best),
          current: scoreVal(stats.latest),
          retentionPct: se ? +(se.trend * 100).toFixed(1) : null,
          status: se ? se.status : null,
          trajectory: se ? se.trajectory : null,
          lastSession: sessionDates.at(-1) ?? null,
        },
        // PR number equals stats.best; pr carries only what's unique: date + set.
        pr: stats.best
          ? { date: stats.best.log.log_date ?? null, bestSet: stats.best.log.raw ?? null }
          : null,
        logs: ascLogs.map((l) => {
          const p = l.raw ? parse(l.raw) : null;
          const w = p ? +score(p).toFixed(2) : null;
          return {
            id: l.id,
            date: l.log_date,
            raw: l.raw,
            weight: w,
            reps: p?.reps ?? null,
            ...(isVol
              ? { volume: p && w != null ? +(w * maxReps(p.reps)).toFixed(1) : null }
              : { e1rm: p && w != null ? +epley1RM(w, p.reps).toFixed(1) : null }),
          };
        }),
      };
    });
    return {
      split: split.name,
      // exercises appear in the user's own display order (drag/move-up-down in Training tab), not alphabetical.
      exercisesOrder: "user-defined display order",
      exercises: exerciseData,
    };
  });

  const payload = {
    source: "LiftOS",
    schema: 2.9,
    tab: "training",
    units: unitsFor(TRAINING_UNIT_KEYS),
    dataSpan: windowOf(
      Object.entries(logsBySlug)
        .filter(([slug]) => activeSlugs.has(slug))
        .flatMap(([, logs]) => logs)
        .map((l) => l.log_date),
    ),
    schedule: { split: "PPL", cycle: SPLITS.map((s) => s.name) },
    splits,
  };
  return JSON.stringify(payload, null, 2);
}
