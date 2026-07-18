// Descriptive correlation signals for the AI export — extra lines of evidence
// so an external analysis can reason about relationships the app deliberately
// does NOT act on. Per the export's standing rule (see nutrition-ai-export
// signals): descriptive only, NEVER a decision input. Nothing in the app reads
// these; they widen what an outside model can notice, no more.
//
// Two pairings, both computed from data already fetched for the export:
//  1. Protein adherence ↔ lean-mass trend — is the floor being met while lean
//     mass holds / falls? (A pairing, not a claim of causation.)
//  2. Recovery inputs ↔ PR days — did the days a lift broke its record carry
//     different sleep / HRV / resting-HR than other training days?
import type { BodyMetric } from "@features/health/api";
import type { NutritionEntry } from "@features/nutrition/api";
import { getProteinResult } from "@features/nutrition/logic";
import { buildLeanMassEvaluation } from "@features/overview/goal";

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const round1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);

export interface ProteinLeanMassSignal {
  windowDays: number;
  loggedProteinDays: number;
  avgProtein: number | null;
  /** Days the protein floor was met, using the app's own `celebrated` rule
   *  (getProteinResult — the 2% tolerance band, the single source of truth). */
  floorMetDays: number;
  floorMetPct: number | null;
  leanMassSlopePerMonthKg: number | null;
  leanMassTrend: "falling" | "stable";
  leanMassConfidence: string;
  note: string;
}

/** Protein-floor adherence paired with the concurrent lean-mass trajectory over
 *  the export window. Both are reported side by side; drawing a conclusion is
 *  the reader's job, not the app's. */
export function proteinVsLeanMass(
  entries: NutritionEntry[],
  metrics: BodyMetric[],
  windowDays: number,
): ProteinLeanMassSignal {
  const withProtein = entries.filter((e) => e.protein != null && e.protein_target != null);
  const proteins = withProtein.map((e) => e.protein as number);
  const floorMet = withProtein.filter(
    (e) => getProteinResult(e.protein as number, e.protein_target as number).celebrated,
  ).length;

  const lm = buildLeanMassEvaluation(metrics);

  return {
    windowDays,
    loggedProteinDays: withProtein.length,
    avgProtein: proteins.length ? Math.round((mean(proteins) as number)) : null,
    floorMetDays: floorMet,
    floorMetPct: withProtein.length ? Math.round((floorMet / withProtein.length) * 100) : null,
    leanMassSlopePerMonthKg: lm.slopePerMonth,
    leanMassTrend: lm.trend,
    leanMassConfidence: lm.confidence,
    note: "Descriptive pairing over the same window — protein-floor adherence beside the lean-mass slope. Not a causal claim and never a decision input; lean-mass slope rides the noisy BIA body-fat reading (low confidence unless flagged falling).",
  };
}

interface RecoveryGroup {
  days: number;
  avgSleepHours: number | null;
  avgHrvMs: number | null;
  avgRestingHr: number | null;
}

export interface RecoveryPerformanceSignal {
  prDays: RecoveryGroup;
  otherTrainingDays: RecoveryGroup;
  note: string;
}

function recoveryGroup(dates: Set<string>, byDate: Map<string, BodyMetric>): RecoveryGroup {
  const sleep: number[] = [];
  const hrv: number[] = [];
  const rhr: number[] = [];
  for (const d of dates) {
    const m = byDate.get(d);
    if (!m) continue;
    if (m.sleep_seconds != null) sleep.push(m.sleep_seconds / 3600);
    if (m.hrv_sdnn_ms != null) hrv.push(m.hrv_sdnn_ms);
    if (m.resting_heart_rate != null) rhr.push(m.resting_heart_rate);
  }
  return {
    days: dates.size,
    avgSleepHours: round1(mean(sleep)),
    avgHrvMs: round1(mean(hrv)),
    avgRestingHr: round1(mean(rhr)),
  };
}

/** Recovery inputs (sleep / HRV / resting HR) on PR days vs other training days,
 *  paired same-date. `prDates` are the days any lift set a new record (from
 *  buildPrEvents); `sessionDates` are all logged training days. Same-date pairs
 *  the morning's readings with that day's session — a proxy for the state going
 *  in, not a claim that recovery caused the PR. */
export function recoveryVsPrDays(
  prDates: Set<string>,
  sessionDates: Set<string>,
  metrics: BodyMetric[],
): RecoveryPerformanceSignal {
  const byDate = new Map<string, BodyMetric>();
  for (const m of metrics) if (m.metric_date) byDate.set(m.metric_date, m);

  const other = new Set<string>();
  for (const d of sessionDates) if (!prDates.has(d)) other.add(d);
  // Only PR days that were actually logged as training days (a PR is by
  // definition a logged set, so this is normally all of them).
  const prTrainingDays = new Set<string>();
  for (const d of prDates) if (sessionDates.has(d)) prTrainingDays.add(d);

  return {
    prDays: recoveryGroup(prTrainingDays, byDate),
    otherTrainingDays: recoveryGroup(other, byDate),
    note: "Recovery readings (sleep / HRV / resting HR) averaged over PR days vs other training days, paired same-date. Descriptive only — small samples, and same-date pairing is a proxy for readiness, not evidence recovery caused the PR. Never a decision input.",
  };
}
