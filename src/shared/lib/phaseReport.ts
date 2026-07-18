// Phase close detection + retrospective generation.
//
// A cut/bulk has no explicit "end" action — it ends the moment the intake goal
// is saved into a different phase band (SettingsSheet's intake row, or the
// Insight card applying an engine recommendation). Both writers call
// maybeClosePhase(prev, next) after a successful saveConfig; when the phase
// KIND actually changed away from a cut/bulk, this settles the ended phase into
// one phase_reports row. Like a logged day, the report is a settled verdict:
// written once from the data in force at close time, upserted on
// (phase_kind, start_date) so band-edge fiddling rewrites rather than
// duplicates, and never recomputed afterwards.
//
// Every number reuses the same derivation the live UI shows (adherence via
// getCalorieResult/isAdherentState against each day's OWN stamped target,
// endpoints via the 14-day cutBaselineAt smoothing that froze the baseline,
// volume via computeWeeklyVolume) — the export/report never re-derives.
import { getEntries, targetsFromConfig, type NutritionConfig } from "@features/nutrition/api";
import { getCalorieResult, isAdherentState, phaseKindFromName, type PhaseKind } from "@features/nutrition/logic";
import { fetchHealthData } from "@features/health/api";
import { cutBaselineAt } from "@features/overview/goal";
import { savePhaseReport } from "@features/overview/api";
import { fetchExercises, fetchLogsBySlug } from "@features/training/api";
import { computeWeeklyVolume } from "@features/training/logic";
import { defaultSetCount } from "@features/training/logFormHelpers";
import { localDateStr } from "@shared/lib/date";

/** Shorter than this and the "phase" was intake-fiddling, not a real phase —
 *  the endpoints are 14-day averages, so a report needs at least that span. */
const MIN_PHASE_DAYS = 14;

const DAY_MS = 86_400_000;
// Pure YYYY-MM-DD arithmetic: Date.parse pins the string to UTC midnight and
// toISOString reads it back from the same clock, so no local-tz day shift.
const shiftDate = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * DAY_MS).toISOString().slice(0, 10);
const spanDaysInclusive = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const meanOrNull = (vals: number[]): number | null =>
  vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

/** Close the phase that `prev` was in, if `next` moved to a different one.
 *  Fire-and-forget safe: every failure (missing baseline, pre-migration table,
 *  network) is swallowed after a console.warn — a failed retrospective must
 *  never break the settings save that triggered it. Returns whether a report
 *  was written. */
export async function maybeClosePhase(prev: NutritionConfig, next: NutritionConfig): Promise<boolean> {
  try {
    const prevT = targetsFromConfig(prev);
    const endedKind = phaseKindFromName(prevT.cutPhaseName);
    const newKind = phaseKindFromName(targetsFromConfig(next).cutPhaseName);
    if (endedKind === newKind || endedKind === "maintenance") return false;

    // The frozen baseline anchors the report's start; without one there is no
    // starting line to settle against (the initializer card never ran).
    const startDate = endedKind === "cut" ? prev.cut_start_date : prev.bulk_start_date;
    const endDate = localDateStr();
    if (!startDate || startDate > endDate) return false;
    const activeDays = spanDaysInclusive(startDate, endDate);
    if (activeDays < MIN_PHASE_DAYS) return false;

    await generateReport(endedKind, startDate, endDate, activeDays, prev, prevT);
    return true;
  } catch (e) {
    console.warn("[phaseReport] close failed:", e);
    return false;
  }
}

async function generateReport(
  kind: PhaseKind,
  startDate: string,
  endDate: string,
  activeDays: number,
  prev: NutritionConfig,
  prevT: ReturnType<typeof targetsFromConfig>,
) {
  const [entries, health, exercises, logsBySlug] = await Promise.all([
    getEntries(startDate, endDate),
    // Metrics back to the phase start plus the baseline's own 14-day window.
    fetchHealthData(spanDaysInclusive(startDate, localDateStr()) + 14),
    fetchExercises(),
    fetchLogsBySlug(),
  ]);

  // ── Adherence & averages — each day judged against its OWN stamped target ──
  const logged = entries.filter((e) => e.calories != null);
  const adherent = logged.filter((e) => {
    const r = getCalorieResult(
      e.calories as number,
      e.tdee ?? prevT.tdee,
      e.deficit_target ?? prevT.deficitTarget,
    );
    return isAdherentState(r.state, r.phase);
  });
  const avgCalories = meanOrNull(logged.map((e) => e.calories as number));
  const avgProtein = meanOrNull(entries.filter((e) => e.protein != null).map((e) => e.protein as number));
  const avgCalorieTarget = meanOrNull(entries.filter((e) => e.calorie_target != null).map((e) => e.calorie_target as number));
  const avgDeficitTarget = meanOrNull(entries.filter((e) => e.deficit_target != null).map((e) => e.deficit_target as number));

  // ── Body-composition endpoints — same 14-day smoothing as the baseline ──
  const startWeight = (kind === "cut" ? prev.cut_start_weight : prev.bulk_start_weight) ?? null;
  const startBf = (kind === "cut" ? prev.cut_start_body_fat_pct : prev.bulk_start_body_fat_pct) ?? null;
  const endPoint = cutBaselineAt(health.metrics, shiftDate(endDate, -13));
  const endWeight = endPoint.weightKg;
  const endBf = endPoint.bodyFatPct;

  const observedRate =
    startWeight != null && endWeight != null ? (endWeight - startWeight) / (activeDays / 7) : null;
  // The plan's implied rate from the phase's average deficit target (7700
  // kcal/kg): a deficit is a negative rate (loss), a surplus target (negative
  // deficit) flips it positive — same sign convention as observedRate.
  const plannedRate = avgDeficitTarget != null ? -(avgDeficitTarget * 7) / 7700 : null;

  // ── TDEE calibration trajectory (descriptive, never gates anything) ──
  // assumed = what the app believed day-by-day (entry-stamped tdee);
  // measured = what the energy balance actually implies over the whole phase.
  // Reads with the logged days taken as complete — logged_days/active_days are
  // stored alongside so a reader can weigh the coverage themselves.
  const assumedTdee = meanOrNull(entries.filter((e) => e.tdee != null).map((e) => e.tdee as number));
  const measuredTdee =
    avgCalories != null && startWeight != null && endWeight != null
      ? avgCalories - ((endWeight - startWeight) * 7700) / activeDays
      : null;

  // ── Training-volume retention — the Weekly Volume card's own derivation,
  //    evaluated at two reference days: ~4 weeks in (first full trailing
  //    window inside the phase) and the close ──
  const roster = exercises.flatMap((e) => {
    const base = { slug: e.slug, split: e.split, setCount: defaultSetCount(e), assistedMode: !!e.assisted_mode };
    if (!e.archived) return [base];
    const lastLog = logsBySlug[e.slug]?.find((l) => l.log_date)?.log_date;
    return lastLog ? [{ ...base, activeUntil: lastLog }] : [];
  });
  const volumeAt = (refDate: string): number | null => {
    if (!roster.length) return null;
    const stat = computeWeeklyVolume(logsBySlug, roster, refDate);
    return stat.avgWeekKg > 0 ? Math.round(stat.avgWeekKg) : null;
  };
  const startRef = shiftDate(startDate, 27);
  const volumeStart = volumeAt(startRef < endDate ? startRef : endDate);
  const volumeEnd = volumeAt(endDate);

  await savePhaseReport({
    phase_kind: kind,
    start_date: startDate,
    end_date: endDate,
    active_days: activeDays,
    logged_days: logged.length,
    adherent_days: adherent.length,
    avg_calories: avgCalories != null ? Math.round(avgCalories) : null,
    avg_protein: avgProtein != null ? Math.round(avgProtein) : null,
    avg_calorie_target: avgCalorieTarget != null ? Math.round(avgCalorieTarget) : null,
    avg_deficit_target: avgDeficitTarget != null ? Math.round(avgDeficitTarget) : null,
    start_weight_kg: startWeight != null ? round1(startWeight) : null,
    end_weight_kg: endWeight != null ? round1(endWeight) : null,
    start_body_fat_pct: startBf != null ? round1(startBf) : null,
    end_body_fat_pct: endBf != null ? round1(endBf) : null,
    observed_rate_kg_wk: observedRate != null ? round2(observedRate) : null,
    planned_rate_kg_wk: plannedRate != null ? round2(plannedRate) : null,
    assumed_tdee: assumedTdee != null ? Math.round(assumedTdee) : null,
    measured_tdee: measuredTdee != null ? Math.round(measuredTdee) : null,
    volume_start_kg_wk: volumeStart,
    volume_end_kg_wk: volumeEnd,
  });
}
