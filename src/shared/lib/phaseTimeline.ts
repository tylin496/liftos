// Target-phase reconstruction, shared between the AI export and the PR + Phase
// timeline. Every nutrition entry snapshots the calorie/protein target active
// the day it was logged (saveEntry writes targetsFromConfig), so the full phase
// timeline lives in the entries themselves — no separate audit table needed. A
// new phase begins whenever the effective target (calories or protein) changes
// from the previous logged day.
//
// Lives here (not in copyAllData) so a UI surface can reconstruct phase spans
// without importing the whole export module — and so both readers share one
// definition of "when did each phase run".
import type { NutritionEntry } from "@features/nutrition/api";
import { phaseFromDeficit, phaseKindFromName, type PhaseKind } from "@features/nutrition/logic";

export interface TargetPhase {
  from: string;
  to: string;
  /** activeDays = inclusive calendar span; loggedDays = how many actually have
   *  an entry (the rest are gaps, not misses). */
  activeDays: number;
  loggedDays: number;
  calorieTarget: number;
  proteinTarget: number | null;
  deficitTarget: number | null;
  tdee: number | null;
  /** Phase NAME from the day's deficit target (Aggressive Cut … Lean Bulk). */
  cutPhase: string | null;
  avgCalories: number | null;
  avgProtein: number | null;
}

export function buildTargetPhases(entries: NutritionEntry[]): TargetPhase[] {
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

/** The phase KIND (cut / maintenance / bulk) in force on a given date, or null
 *  when the date falls outside every reconstructed span (before the first
 *  logged target, or in a gap with no target on record). Spans are contiguous
 *  by construction, so a simple containment scan suffices. */
export function phaseKindAt(phases: TargetPhase[], date: string): PhaseKind | null {
  for (const p of phases) {
    if (date >= p.from && date <= p.to && p.cutPhase) return phaseKindFromName(p.cutPhase);
  }
  // Past the last span's `to` (today's still-open phase hasn't logged up to the
  // PR date yet): attribute to the most recent span the date is at or after.
  const after = phases.filter((p) => p.cutPhase && date >= p.from);
  const last = after.at(-1);
  return last?.cutPhase ? phaseKindFromName(last.cutPhase) : null;
}
