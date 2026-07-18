import { fetchHealthData } from "@features/health/api";
import { getConfig, getEntries, targetsFromConfig } from "@features/nutrition/api";
import { monthlyStats, weeklyStats, trainingMonthsFromStart, phaseKindFromName } from "@features/nutrition/logic";
import { buildTargetPhases } from "./phaseTimeline";
import { getNutritionState, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import { localDateStr } from "@shared/lib/date";
import { weeklyWeightRate, tdeeCalibration, confidenceBreakdownFromSeries, MIN_TREND_POINTS, type TdeeCalibration, type ConfidenceBreakdown } from "@features/nutrition/evaluation";
import { nutritionDecision } from "@features/nutrition/recommendation";
import { fetchExercises, fetchLogsBySlug, fetchLatestBodyweight } from "@features/training/api";
import { parse, score } from "@features/training/parser";
import { computeStats, computeMuscleWeeklyVolume, epley1RM, maxReps, scoreWeight } from "@features/training/logic";
import { computeStrengthSummary, fetchPhaseReports, type StrengthExercise, type PhaseReport } from "@features/overview/api";
import { canonicalLift, strengthStanding, isSex } from "@features/training/strengthStandards";
import { buildPrEvents } from "@features/training/logic";
import { proteinVsLeanMass, recoveryVsPrDays } from "./exportCorrelations";
import { inferMuscleGroup, resolveMuscleBySlug } from "@features/training/muscleGroup";
import { computeMuscleClusters, suggestClusterFatigue } from "@features/training/muscleCluster";
import { buildMuscleGrid } from "@features/training/muscleGrid";
import { defaultSetCount } from "@features/training/logFormHelpers";
import { SPLITS } from "@features/training/seed";
import { estimateTdee } from "@features/health/tdee";
import { computeRecovery, sanitizeMetrics, DAYTYPE_WINDOW_DAYS, type DayTypeBaselines } from "@features/health/math";

export const EXPORT_HEALTH_DAYS = 60;
export const EXPORT_NUTRITION_DAYS = 60;
// Budget over the COMPACT (no-indent) serialization — exports are for LLM
// consumption, and pretty-print indentation was costing ~half the budget.
const MAX_AI_EXPORT_CHARS = 80_000;
// Per-tab "Copy" exports carry the tab's full data (no char budget) — the
// Overview snapshot stays the condensed executive summary. These windows are
// generous so an analysis of a single tab has the complete recent history.
const FULL_HEALTH_DAYS = 365;
const FULL_NUTRITION_DAYS = 180;
// Recent training sessions kept per exercise (plus the PR session if it falls
// outside this window) — full history isn't needed for strength analysis.
const MAX_TRAINING_LOGS_PER_EXERCISE = 15;

/** A structured "why this status" for a strength lift, read straight off the same
 *  settled flags the Training card uses — so the export reader shows a reason
 *  ("Below peak") without re-judging the numbers. `weeksSinceImprovement` is
 *  `stalledWeeks`: whole weeks since the lift was last AT its ceiling (a PR on
 *  either axis OR a plain tie), so it counts stalls, not only PR droughts.
 *  null-safe: a lift with too little data to summarise is `insufficient_data`. */
function strengthReason(se: StrengthExercise | undefined) {
  if (!se) return { code: "insufficient_data" as const };
  if (se.declining) return { code: "recent_drop" as const, weeksSinceImprovement: se.stalledWeeks };
  if (se.status === "watch")
    return se.recovering
      ? { code: "recovering" as const, weeksSinceImprovement: se.stalledWeeks }
      : { code: "below_peak" as const, weeksSinceImprovement: se.stalledWeeks };
  if (se.status === "stable") return { code: "holding" as const, weeksSinceImprovement: se.stalledWeeks };
  return { code: "at_peak" as const }; // status === "improving": at / new PR
}

/** Trajectory for export. `velocity` internally is a bare fraction (latest ÷
 *  anchor − 1) — shipped raw, a reader can't tell −0.08 from "−0.08 kg" or
 *  "per week". Emit it as `velocityPct` so the unit lives in the name; the
 *  window/anchor definition ships once in insights.training.note. */
function exportTrajectory(se: StrengthExercise | undefined) {
  if (!se?.trajectory) return null;
  const { direction, velocity, confidence } = se.trajectory;
  return { direction, velocityPct: +(velocity * 100).toFixed(1), confidence };
}

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

// Export shape for the Energy card's training-day vs rest-day active
// baselines — self-describing keys instead of the UI's terse trainAvg/restAvg.
function activeBaselinesFor(d: DayTypeBaselines | null) {
  if (!d) return null;
  return {
    trainingDayAvg: d.trainAvg,
    restDayAvg: d.restAvg,
    trainingDays: d.trainN,
    restDays: d.restN,
    windowDays: DAYTYPE_WINDOW_DAYS,
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

/** A settled phase_reports row minus its storage plumbing — the report fields
 *  ARE the export shape (they were settled at close time from the same UI
 *  derivations; see shared/lib/phaseReport.ts). */
function phaseReportForExport(r: PhaseReport) {
  const { id: _id, user_id: _user, created_at: _created, ...report } = r;
  return report;
}

/** The absolute strength-standard read for an export, or null when it doesn't
 *  apply (non-canonical lift, sex unset, or no bodyweight). Same derivation the
 *  Training trend sheet shows — an objective ladder position off the all-time
 *  best e1RM, complementing the PR-distance retention already emitted. */
function strengthStandardForExport(
  ex: { name: string; compound: boolean | null; assisted_mode: boolean | null },
  peakE1rmKg: number | null,
  bodyweightKg: number | null,
  sex: string | null | undefined,
) {
  const standing = strengthStanding(
    canonicalLift({ name: ex.name, compound: !!ex.compound, assisted_mode: !!ex.assisted_mode }),
    peakE1rmKg,
    bodyweightKg,
    isSex(sex) ? sex : null,
  );
  if (!standing) return null;
  return {
    lift: standing.lift,
    level: standing.level,
    bodyweightMultiple: standing.ratio,
    nextLevel: standing.nextLevel,
    kgToNext: standing.kgToNext,
  };
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
      // The span changeFromStart actually covers: first READING → latest. On a
      // sparse metric the first reading can sit far inside the window, so
      // periodDays alone over-states the change's timespan.
      changeSpanDays: Math.round((Date.parse(latest.date) - Date.parse(pts[0].date)) / 86_400_000),
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

  const [health, nutritionConfig, nutritionEntries, nutritionStateFull, exercises, logsBySlug, phaseReports] = await Promise.all([
    fetchHealthData(healthDays).catch(() => null),
    getConfig().catch(() => null),
    getEntries(nutritionStart, today).catch(() => []),
    getNutritionState().catch(() => null),
    fetchExercises().catch(() => []),
    fetchLogsBySlug().catch(() => ({} as Record<string, import("@features/training/api").TrainingLog[]>)),
    fetchPhaseReports().catch(() => []),
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
  // loggedIntake/intakeGap round-trip from the persisted row (0016) — the same
  // values evaluate() used to set the stored confidence, so the export can never
  // disagree with the app.
  const nutritionLoggedIntake = nutritionStateFull?.diagnostics.loggedIntake ?? null;
  const nutritionIntakeGap = nutritionStateFull?.diagnostics.intakeGap ?? null;
  const nutritionCalibration: TdeeCalibration | null =
    nutritionConfig && nutritionStateFull
      ? tdeeCalibration({
          assumedTdee: nutritionConfig.tdee,
          estimatedTdee: nutritionStateFull.diagnostics.estimatedTdee,
          // true only when there's real HealthKit energy data (else estimatedTdee
          // fell back to the assumed TDEE) — gates the under-logging attribution.
          healthTdeeMeasured: tdeeEst.tdee != null,
          loggedIntake: nutritionLoggedIntake,
          observedRate: nutritionStateFull.evaluation.observedRate,
          weightTrustworthy:
            nutritionStateFull.diagnostics.weightDataPoints >= MIN_TREND_POINTS &&
            nutritionStateFull.evaluation.confidence !== "low",
          assumeCompleteLogging: nutritionConfig.assume_complete_logging,
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
  const nutritionEngine = engineHypothesis(nutritionStateFull, nutritionCalibration, nutritionConfidence);
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
  // Trend-derived counterpart: the same deficit re-solved from the observed
  // weight slope (the engine's own basis). Food logs typically under-record a
  // little, so the logged-intake figure overstates — emit both, labelled, so an
  // external reader doesn't take the bookkeeping number as measured fact.
  const trendRate = nutritionStateFull?.evaluation.observedRate ?? null; // kg/week, negative = losing
  const trendDeficitDaily = trendRate != null ? Math.round((-trendRate * 7700) / 7) : null;
  const deficitSummary =
    deficitDaily != null
      ? {
          daily: deficitDaily,
          windowDays: SHORT_WINDOW_DAYS, // deficit is derived from the 30d avg
          // 7700 kcal ≈ 1 kg fat; project over 30 days to get kg/month
          estimatedFatLoss: +((deficitDaily * 30) / 7700).toFixed(2),
          // `basis` covers daily/estimatedFatLoss ONLY — the trend* figures
          // below have their own trendBasis. A single object-level basis was
          // read as covering all four numbers.
          basis: "logged-intake",
          ...(trendDeficitDaily != null
            ? {
                trendDaily: trendDeficitDaily,
                trendFatLoss: +((trendDeficitDaily * 30) / 7700).toFixed(2),
                trendBasis: "weight-trend (observedRate × 7700/7)",
              }
            : {}),
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
      undefined,
      true,
      new Set(exercises.filter((e) => e.assisted_mode).map((e) => e.slug)),
    ).exercises.map((x) => [x.slug, x]),
  );
  const nameBySlug = new Map(exercises.map((e) => [e.slug, e.name]));
  const trainingAttention = [...strengthBySlug.values()]
    .filter((x) => x.needsAttention)
    .sort((a, b) => a.trend - b.trend) // worst (furthest below PR) first
    .map((x) => ({
      name: nameBySlug.get(x.slug) ?? x.name,
      status: x.status,
      // Structured reason so the reader shows "Below peak" without re-judging.
      reason: strengthReason(x),
      retentionPct: +(x.trend * 100).toFixed(1),
      // Weeks since the lift was last at its ceiling (PR OR tie) — a stall clock,
      // not a PR drought (holding a PR doesn't advance it). (renamed from weeksSincePR)
      weeksSinceImprovement: x.stalledWeeks,
    }));
  const improvingCount = [...strengthBySlug.values()].filter((x) => !x.needsAttention).length;

  // Muscle-cluster fatigue: several lifts of one primary muscle sliding together
  // in the same block — a systemic signal a per-lift read can't see. Riding on
  // trajectory; muscle resolved override-first then name/slug/split (the same
  // resolveMuscleBySlug the cards use). Only the flagged (systemic) groups are
  // surfaced, each with its muscle-level action.
  const muscleBySlug = resolveMuscleBySlug(exercises);
  const muscleOf = (x: { slug: string; name: string }) =>
    muscleBySlug.get(x.slug) ?? inferMuscleGroup(x.name, x.slug);
  const muscleFatigue = computeMuscleClusters([...strengthBySlug.values()], muscleOf)
    .map((c) => suggestClusterFatigue(c, (s) => nameBySlug.get(s) ?? s))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  // Per-muscle rollup (every tracked group, not only systemic-flagged ones) so
  // the reader gets the group's state pre-computed instead of re-averaging lifts.
  // Reuses the Training card's grid: `pct` is worst-lift retention (min, not
  // mean — a problem lift isn't diluted by healthy neighbours), `status` the
  // most-severe lift's tier. "now" is the latest logged session (recency is
  // relative to the data, not wall-clock).
  const strengthExercises = [...strengthBySlug.values()];
  const trainingNowMs = Math.max(
    0,
    ...strengthExercises.map((x) => Date.parse(x.lastLogDate) || 0),
  );
  const muscleSummary = buildMuscleGrid(strengthExercises, trainingNowMs, muscleOf).map((cell) => {
    const byRetention = [...cell.lifts].sort((a, b) => a.trend - b.trend);
    const worst = byRetention[0];
    const best = byRetention[byRetention.length - 1];
    return {
      group: cell.group,
      retentionPct: cell.pct,
      status: cell.status,
      bestLift: best ? (nameBySlug.get(best.slug) ?? best.name) : null,
      worstLift: worst ? (nameBySlug.get(worst.slug) ?? worst.name) : null,
      improving: cell.lifts.filter((l) => l.status === "improving").length,
      watch: cell.lifts.filter((l) => l.status === "watch").length,
      recovering: cell.lifts.some((l) => l.recovering),
    };
  });

  // Per-muscle average weekly working sets — the SAME derivation the Weekly
  // Volume card's muscle view uses (computeMuscleWeeklyVolume re-buckets
  // computeWeeklyVolume's carry-forward rows), never re-derived here. Sets, not
  // kg: tonnage isn't comparable across muscle groups.
  // Archived lifts keep their history (activeUntil = final log) but stop
  // carrying forward past it — same roster rule as the Training page.
  const volumeRoster = exercises.flatMap((e) => {
    const base = { slug: e.slug, split: e.split, setCount: defaultSetCount(e), assistedMode: !!e.assisted_mode };
    if (!e.archived) return [base];
    const lastLog = logsBySlug[e.slug]?.find((l) => l.log_date)?.log_date;
    return lastLog ? [{ ...base, activeUntil: lastLog }] : [];
  });
  // Window averages divide by 3s and 4s — round at the export boundary like
  // roundRecovery does, so the JSON doesn't carry float noise.
  const round1 = (v: number) => +v.toFixed(1);
  const muscleWeeklyVolume = computeMuscleWeeklyVolume(
    logsBySlug,
    volumeRoster,
    localDateStr(now),
    (ex) =>
      muscleBySlug.get(ex.slug) ??
      inferMuscleGroup(nameBySlug.get(ex.slug) ?? ex.slug, ex.slug, ex.split),
  ).map((m) => ({
    group: m.group,
    // Basis: average working sets per week over the trailing ≤4 *completed*
    // Mon–Sun weeks (clipped to history; the in-progress week is excluded so a
    // partial week never dilutes the average). Unlogged split-weeks inherit
    // the split's last logged week (no log = maintained, never zero) — so a
    // low muscle means a logged week actually shrank, not that logging paused.
    // deltaSets = avgWeekSets − prevAvgWeekSets (the ≤4 completed weeks before
    // those); prevAvgWeekSets null = no prior window yet. Without the baseline
    // exported, every reader recomputes a single week and concludes deltaSets
    // is wrong.
    avgWeekSets: round1(m.avgWeekSets),
    prevAvgWeekSets: m.prevAvgWeekSets === null ? null : round1(m.prevAvgWeekSets),
    deltaSets: m.deltaSets === null ? null : round1(m.deltaSets),
  }));

  // Descriptive correlation signals (never gate decisions — see
  // exportCorrelations). PR days + all training days across every non-archived
  // lift, from the same logs the export already holds.
  const prDates = new Set<string>();
  const sessionDates = new Set<string>();
  for (const ex of exercises) {
    if (ex.archived) continue;
    const raw = (allLogsBySlug[ex.slug] ?? []).map((e) => e.log);
    for (const l of raw) if (l.log_date) sessionDates.add(l.log_date);
    for (const evt of buildPrEvents(raw, defaultSetCount(ex), ex.compound ? "compound" : "isolation", !!ex.assisted_mode)) {
      prDates.add(evt.date);
    }
  }
  const correlations = {
    proteinVsLeanMass: proteinVsLeanMass(sortedEntries, metrics, nutritionDays),
    recoveryVsPerformance: recoveryVsPrDays(prDates, sessionDates, metrics),
  };

  const insights = {
    weight: weightTrend,
    // Descriptive pairings for an external analysis — never decision inputs.
    correlations,
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
      // Definitions a reader of THIS block needs (they otherwise live only in
      // distant docstrings): retentionPct here and in training[].performance is
      // the same current ÷ peak on the lift's scoring axis.
      note: "retentionPct = current ÷ peak on the lift's scoring axis (compound: e1RM; isolation: best-set tonnage; assisted: %bodyweight). trajectory.velocityPct = % change of the recent session-best vs its anchor session (recovering: window min, declining: window max) over the recent-sessions window — not kg, not per-week.",
      exercisesTracked: improvingCount + trainingAttention.length,
      improvingCount,
      needsAttentionCount: trainingAttention.length,
      attention: trainingAttention,
      // Per-muscle rollup for every tracked group (state, best/worst lift, counts).
      muscleSummary,
      // Muscle-level fatigue clusters (systemic only) — empty when nothing lines up.
      muscleFatigue,
      // Average working sets per muscle group per week over the trailing ≤4
      // completed Mon–Sun weeks (carry-forward; delta vs the previous window)
      // — the progression-input read a bulk is steered by.
      muscleWeeklyVolume,
    },
  };

  // Latest recorded bodyweight — the strength-standard divisor (same value the
  // Training trend sheet uses). Metrics are ascending, so the last weight wins.
  const latestBodyweight = metrics.filter((m) => m.weight_kg != null).at(-1)?.weight_kg ?? null;

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
        const stats = computeStats(allRaw, setCount, ex.compound ? "compound" : "isolation", !!ex.assisted_mode);

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
        // `performance.metric` names the scoring axis (compound → e1RM, isolation →
        // best-set tonnage/volume); peak/current speak that unit. Volume is a
        // kg·reps product, never lb-converted. (schema 3.1)
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
          // One performance object so every reader keys off a single source:
          // `metric` names the scoring axis (compound → e1RM, isolation → best-set
          // tonnage), and peak/current/retentionPct all speak that unit. retention
          // = current ÷ peak (PR-distance; see strengthBySlug above). e1RM still
          // exists for isolation lifts — this is just the axis status/PR reference.
          performance: {
            metric: isVol ? "volume" : "e1rm",
            // Assisted lifts score on % of bodyweight lifted (logic.ts
            // scoreWeight) so a cut/bulk can't move the trend; peak/current/
            // per-log e1rm speak that unit, while `weight` stays real kg.
            ...(ex.assisted_mode ? { unit: "%bodyweight" } : {}),
            peak: scoreVal(stats.best),
            current: scoreVal(stats.latest),
            retentionPct: se ? +(se.trend * 100).toFixed(1) : null,
          },
          // Interpretation, kept distinct from the numbers above: status = where
          // the lift sits now (improving/stable/watch); reason = why, as a code so
          // the reader needn't re-judge; trajectory = which way / how fast the
          // recent window reads (separate from retention). (schema 3.1)
          status: se ? se.status : null,
          reason: strengthReason(se),
          trajectory: exportTrajectory(se),
          // Absolute strength-standard ladder position (canonical barbell lifts
          // only; needs sex + bodyweight). Complements retentionPct's own-past
          // read with a population coordinate. null when it doesn't apply.
          strengthStandard: strengthStandardForExport(ex, stats.best?.e1rm ?? null, latestBodyweight, nutritionConfig?.sex),
          sessions: sessionDates.length,
          lastSession,
          // The PR number equals stats.best, so pr carries only what's unique: the
          // date and the exact set. bestSet is canonical (parser rebuilds weight/reps).
          pr: stats.best
            ? { date: stats.best.log.log_date ?? null, bestSet: stats.best.log.raw ?? null }
            : null,
          logs: sliced.map(({ log: l, parsed: p, w }) => {
            // Score axes on scoreWeight (%BW for an assisted-mode exercise) — matches
            // computeStats above, so per-log e1rm and peak/current agree. NaN (a
            // non-assisted log on a %BW axis) collapses to null, like toLogEntry drops it.
            const swRaw = p ? scoreWeight(p, !!ex.assisted_mode) : null;
            const sw = swRaw != null && Number.isFinite(swRaw) ? swRaw : null;
            return {
              date: l.log_date,
              raw: l.raw,
              weight: w,
              reps: p?.reps ?? null,
              ...(isVol
                ? { volume: p && sw != null ? +(sw * maxReps(p.reps)).toFixed(1) : null }
                : { e1rm: p && sw != null ? +epley1RM(sw, p.reps).toFixed(1) : null }),
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

  // Primary goal named from the phase KIND (same derivation the app's
  // evaluation carries), so a surplus config reads "Lean bulk", not "Fat loss".
  const cutPhase = targets?.cutPhaseName ?? null;
  const phaseKind = cutPhase != null ? phaseKindFromName(cutPhase) : null;
  const inferredGoal =
    phaseKind === "maintenance" ? "Maintenance" :
    phaseKind === "bulk" ? "Lean bulk" :
    phaseKind != null ? "Fat loss" : null;

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
    schema: 3.1,
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
      // Lean-bulk plan (0017) — the persisted baseline + the body-fat ceiling
      // that ends the bulk. null until a bulk baseline is set (or pre-migration).
      bulk: nutritionConfig?.bulk_start_date
        ? {
            startDate: nutritionConfig.bulk_start_date,
            startWeight: nutritionConfig.bulk_start_weight ?? null,
            startBodyFat: nutritionConfig.bulk_start_body_fat_pct ?? null,
            bfCeiling: nutritionConfig.bulk_bf_ceiling ?? null,
          }
        : null,
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
      // Training-day vs rest-day active baselines — the same values the Energy
      // card shows (health.dayType, computed once in fetchHealthData).
      // Descriptive context: two typical days, never a target or a prediction.
      activeBaselines: activeBaselinesFor(health?.dayType ?? null),
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
      // Settled retrospectives of CLOSED cut/bulk phases — written once at
      // close time (phaseReport.ts) from the same UI derivations, never
      // recomputed. Descriptive history; nothing downstream gates on it.
      closedPhases: phaseReports.map(phaseReportForExport),
      engine: nutritionEngine,
      summary: {
        periodDays: nutritionDays,
        days: sortedEntries.length,
        sampleDays: logged.length,
        avgCalories,
        avgProtein,
      },
      // Columnar like health.timeline (dates + aligned value arrays) — drops
      // the per-row repeated keys. Per-day targets live in `phases` above.
      entries: {
        dates: sortedEntries.map((e) => e.entry_date),
        calories: sortedEntries.map((e) => e.calories),
        protein: sortedEntries.map((e) => e.protein),
      },
    },
    training: buildTraining(logsPerEx),
  });

  // Binary search for the largest logsPerEx that fits within MAX_AI_EXPORT_CHARS,
  // capped at MAX_TRAINING_LOGS_PER_EXERCISE — recent history plus stats/pr is
  // sufficient, so there's no need to search beyond that.
  let lo = 1;
  const maxLogsAnyExercise = Math.max(0, ...exercises.map((ex) => (allLogsBySlug[ex.slug]?.length ?? 0)));
  let hi = Math.max(1, Math.min(MAX_TRAINING_LOGS_PER_EXERCISE, maxLogsAnyExercise));
  let result = JSON.stringify(buildPayload(lo));

  if (JSON.stringify(buildPayload(hi)).length <= MAX_AI_EXPORT_CHARS) {
    // Full data fits — return everything
    return JSON.stringify(buildPayload(hi));
  }

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const json = JSON.stringify(buildPayload(mid));
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
    schema: 3.0,
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
    // Same values the Energy card shows (health.dayType) — see activeBaselinesFor.
    activeBaselines: activeBaselinesFor(health?.dayType ?? null),
    summary: buildHealthSummary(metrics, days),
    timeline: buildHealthTimeline(metrics),
  };
  return JSON.stringify(payload);
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
  const diagnostics = state.diagnostics;
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
  if (diagnostics.intakeGap != null) {
    rulesTriggered.push(diagnostics.intakeGap > 0 ? "intake_above_estimate" : "intake_below_estimate");
  }
  return {
    engine: "LiftOS",
    version: 3.0,
    note: "LiftOS's current hypothesis from its own rules — audit it against the data above; don't assume it's correct.",
    rulesTriggered,
    evaluation: state.evaluation,
    // The inputs behind evaluation.confidence, so a reviewer can re-derive (or
    // dispute) it rather than take the label at face value. loggedIntake/intakeGap/
    // longestGap round-trip from the persisted row (0016) — the same values
    // evaluate() used to set the confidence label.
    diagnostics,
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

  const [config, entries, state, health, phaseReports] = await Promise.all([
    getConfig().catch(() => null),
    getEntries(start, today).catch(() => []),
    getNutritionState().catch(() => null),
    // Weight series — needed to decompose confidence (scatter/gap aren't persisted).
    fetchHealthData(90).catch(() => null),
    fetchPhaseReports().catch(() => []),
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

  // loggedIntake / intakeGap round-trip from the persisted row (0016) — the same
  // values evaluate() used, so the export never re-derives them differently.
  const loggedIntake = state?.diagnostics.loggedIntake ?? null;
  const intakeGap = state?.diagnostics.intakeGap ?? null;

  // TDEE calibration cross-check (inform-only): compare the TDEE the target is
  // built on (config.tdee) against measured burn + the log/weight-implied TDEE.
  const calibration: TdeeCalibration | null =
    config && state
      ? tdeeCalibration({
          assumedTdee: config.tdee,
          estimatedTdee: state.diagnostics.estimatedTdee,
          healthTdeeMeasured: health?.tdee?.tdee != null,
          loggedIntake,
          observedRate: state.evaluation.observedRate,
          weightTrustworthy:
            state.diagnostics.weightDataPoints >= MIN_TREND_POINTS &&
            state.evaluation.confidence !== "low",
          assumeCompleteLogging: config.assume_complete_logging,
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
    schema: 3.0,
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
    // Settled retrospectives of CLOSED cut/bulk phases (see buildAllDataJson).
    closedPhases: phaseReports.map(phaseReportForExport),
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
    // Columnar like health.timeline (dates + aligned value arrays) — drops the
    // per-row repeated keys. Per-day targets are NOT inlined: `phases` above
    // already maps every date range to the target in force on that day.
    entries: {
      dates: sorted.map((e) => e.entry_date),
      calories: sorted.map((e) => e.calories),
      protein: sorted.map((e) => e.protein),
    },
  };
  return JSON.stringify(payload);
}

/** Training tab: every active exercise per split with full log history, PR, stats, trend. */
export async function buildTrainingJson(): Promise<string> {
  const [exercises, logsBySlug, config, bodyweightKg] = await Promise.all([
    fetchExercises().catch(() => []),
    fetchLogsBySlug().catch(
      () => ({}) as Record<string, import("@features/training/api").TrainingLog[]>,
    ),
    // Sex + latest bodyweight — the strength-standard inputs (both best-effort).
    getConfig().catch(() => null),
    fetchLatestBodyweight().catch(() => null),
  ]);

  // PR-distance status per exercise (same model as the Training Health card).
  const strengthBySlug = new Map<string, StrengthExercise>(
    computeStrengthSummary(
      Object.fromEntries(
        exercises.filter((e) => !e.archived).map((e) => [e.slug, logsBySlug[e.slug] ?? []]),
      ),
      new Set(exercises.filter((e) => e.compound).map((e) => e.slug)),
      undefined,
      true,
      new Set(exercises.filter((e) => e.assisted_mode).map((e) => e.slug)),
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
      const stats = computeStats(ascLogs, setCount, ex.compound ? "compound" : "isolation", !!ex.assisted_mode);
      const se = strengthBySlug.get(ex.slug);
      const sessionDates = [...new Set(ascLogs.map((l) => l.log_date).filter(Boolean))].sort();

      // Mirrors buildAllDataJson: one `performance` object (metric + peak +
      // current + retentionPct, all in the scoring axis's unit), with status /
      // reason / trajectory as the distinct interpretation layer. (schema 3.1)
      const isVol = !ex.compound;
      const scoreVal = (s: (typeof stats)["best"]) =>
        s ? +(isVol ? s.tonnage : s.e1rm).toFixed(1) : null;

      return {
        name: ex.name,
        // Stable identifier — set at creation, never changes if the exercise is
        // renamed. Use this (not `name`) to track an exercise across edits.
        slug: ex.slug,
        target: ex.target ?? null,
        performance: {
          metric: isVol ? "volume" : "e1rm",
          // Assisted lifts score on % of bodyweight lifted (logic.ts scoreWeight);
          // see buildAllDataJson's mirror of this block.
          ...(ex.assisted_mode ? { unit: "%bodyweight" } : {}),
          peak: scoreVal(stats.best),
          current: scoreVal(stats.latest),
          retentionPct: se ? +(se.trend * 100).toFixed(1) : null,
        },
        status: se ? se.status : null,
        reason: strengthReason(se),
        trajectory: exportTrajectory(se),
        // Absolute strength-standard ladder position — see buildAllDataJson.
        strengthStandard: strengthStandardForExport(ex, stats.best?.e1rm ?? null, bodyweightKg, config?.sex),
        sessions: sessionDates.length,
        lastSession: sessionDates.at(-1) ?? null,
        // PR number equals stats.best; pr carries only what's unique: date + set.
        pr: stats.best
          ? { date: stats.best.log.log_date ?? null, bestSet: stats.best.log.raw ?? null }
          : null,
        logs: ascLogs.map((l) => {
          const p = l.raw ? parse(l.raw) : null;
          const w = p ? +score(p).toFixed(2) : null;
          // Score axes on scoreWeight (%BW for an assisted-mode exercise) — matches
          // computeStats. NaN (non-assisted log on a %BW axis) collapses to null.
          const swRaw = p ? scoreWeight(p, !!ex.assisted_mode) : null;
          const sw = swRaw != null && Number.isFinite(swRaw) ? swRaw : null;
          return {
            date: l.log_date,
            raw: l.raw,
            weight: w,
            reps: p?.reps ?? null,
            ...(isVol
              ? { volume: p && sw != null ? +(sw * maxReps(p.reps)).toFixed(1) : null }
              : { e1rm: p && sw != null ? +epley1RM(sw, p.reps).toFixed(1) : null }),
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
    schema: 3.1,
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
  return JSON.stringify(payload);
}
