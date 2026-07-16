// Nutrition business logic — ported faithfully from legacy/nutrition/app.js.
// Pure, typed, framework-free so it is trivial to test and reuse.

export const DEFAULTS = {
  tdee: 2705,
  proteinTarget: 180,
  deficitTarget: 500,
} as const;

// Names a phase by its daily deficit (negative = surplus). The cutpoints track
// weekly rate regimes via the ~7700 kcal/kg rule (weekly change ≈ deficit × 7 / 7700):
//   ≤-100 Lean Bulk    (surplus ≥100 — deliberately eating above maintenance)
//   <200  Maintenance  (-99..199 — inside daily TDEE-estimate error, neither cutting nor bulking)
//   <500  Cruise       (~0.18–0.45 kg/wk loss — gentle, lean-mass-sparing)
//   <800  Moderate Cut (~0.45–0.73 kg/wk)
//   ≥800  Aggressive   (>~0.73 kg/wk)
// ONE bulk gear on purpose (the "Cut is one phase" lesson): intensity lives in
// the intake number, judgment lives in the gain band, not in more phase names.
export function phaseFromDeficit(deficit: number): string {
  if (deficit <= -100) return "Lean Bulk";
  if (deficit < 200) return "Maintenance";
  if (deficit < 500) return "Cruise";
  if (deficit < 800) return "Moderate Cut";
  return "Aggressive Cut";
}

// ── Phase kind & polarity — the single source every judgment/tone site derives
// direction from. Derived from the phase NAME (persisted as `cut_mode` on the
// evaluation row), so all surfaces of one snapshot agree. ────────────────────

export type PhaseKind = "cut" | "maintenance" | "bulk";

export function phaseKindFromName(phase: string): PhaseKind {
  if (phase === "Lean Bulk") return "bulk";
  if (phase === "Maintenance") return "maintenance";
  return "cut";
}

/** Sign of "progress" on the scale: multiply observedRate (kg/wk, negative =
 *  losing) by this to get movement in the phase direction. Maintenance keeps
 *  the cut's −1 — it has no band, so the direction only shapes copy/tones. */
export function phaseDirection(kind: PhaseKind): 1 | -1 {
  return kind === "bulk" ? 1 : -1;
}

/** Weight-metric polarity for display surfaces (MetricDelta direction,
 *  sparkline tone). Only WEIGHT flips on a bulk; body fat stays down-good in
 *  every phase and lean mass stays uncoloured (context, not verdict). */
export function weightMetricDirection(kind: PhaseKind): "up-good" | "down-good" {
  return kind === "bulk" ? "up-good" : "down-good";
}

// Four states, named by intake vs the calorie budget. Colour follows the app's
// single four-level verdict scale (see [[feedback-text-color-rule]]): on-target
// green; ANY deviation amber (direction told by the glyph, not the colour); only
// a surplus (no deficit at all — actively working against the cut) is red.
//   counter — intake worked against the phase                → 🔴 bad
//             (cut: ate above maintenance — no deficit at all;
//              bulk: ate at/below maintenance — no surplus at all;
//              maintenance: never — a deadband has no "against")
//   over    — ate above the intake budget                     → 🟠 warn  ▲
//   on-plan — hit the target band                             → 🟢 good  ●
//   under   — ate below the intake budget                     → 🟠 warn  ▼
// (Formerly surplus/over/on-plan/low-intake — cut-only names.)
export type CalorieState = "counter" | "over" | "on-plan" | "under";

export interface CalorieResult {
  deficit: number;
  surplus: number;
  isSurplus: boolean;
  isPerfect: boolean;
  state: CalorieState;
  /** Phase named by the day's own deficit_target snapshot — drives copy and
   *  adherence direction downstream. */
  phase: PhaseKind;
  celebrated: boolean;
  progress: number;
  status: "Deficit" | "Surplus";
}

const roundInt = (n: number) => Math.round(n || 0);

function progressPercent(value: number, target: number): number {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export function getCalorieResult(
  calories: number,
  tdee: number = DEFAULTS.tdee,
  deficitTarget: number = DEFAULTS.deficitTarget,
): CalorieResult {
  const rawDelta = roundInt(tdee - calories); // signed daily deficit (− = surplus)
  const isSurplus = rawDelta < 0;
  const deficit = Math.max(rawDelta, 0);
  const surplus = Math.max(-rawDelta, 0);
  const target = roundInt(deficitTarget); // signed (− = surplus target → bulk)
  const phase = phaseKindFromName(phaseFromDeficit(target));

  // Symmetric band around the target, in intake kcal. ±25% of the target
  // magnitude reproduces the original cut band exactly (target 500 → on-plan
  // 375–625); the 125 floor keeps the band sane for small targets, where ±25%
  // collapses below food-logging error (a 200 kcal surplus target would get
  // ±50). Both numbers are product judgments, not outcome-calibrated.
  const halfWidth = Math.max(125, Math.round(Math.abs(target) * 0.25));
  const dev = rawDelta - target; // + = ate less than plan, − = ate more

  let state: CalorieState;
  if (Math.abs(dev) <= halfWidth) {
    state = "on-plan";
  } else if (dev < 0) {
    // Ate more than plan. On a cut, erasing the deficit entirely is the red
    // "worked against the phase" read; merely under-shooting it stays amber.
    state = phase === "cut" && rawDelta < 0 ? "counter" : "over";
  } else {
    // Ate less than plan. On a bulk, erasing the surplus entirely is the red
    // mirror; a smaller-than-planned surplus stays amber.
    state = phase === "bulk" && rawDelta >= 0 ? "counter" : "under";
  }

  // Kcal moved in the phase direction — deficit kept on a cut, surplus kept on
  // a bulk. Only over-days show partial progress (the plan fell short).
  const achieved = phase === "bulk" ? -rawDelta : rawDelta;

  return {
    deficit,
    surplus,
    isSurplus,
    isPerfect: state === "on-plan" && rawDelta === target,
    state,
    phase,
    celebrated: state === "on-plan",
    progress: state === "over" ? progressPercent(Math.max(0, achieved), Math.abs(target)) : 100,
    status: isSurplus ? "Surplus" : "Deficit",
  };
}

export interface ProteinResult {
  isPerfect: boolean;
  progress: number;
  celebrated: boolean;
}

// The floor carries a small tolerance band: food/whey/label numbers all run
// ±5–20%, so a gap smaller than the estimation error itself is false precision
// — punishing it (amber, "3g short") implies a decision to eat more that
// doesn't exist. We swallow gaps within 2% of the target and treat the day as
// met. 2% (≈3g on a 160g floor) stays tighter than the measurement noise, so a
// real shortfall (156/160) still reads as short. `celebrated` is the system's
// success event — it gates confetti, the double-hit count, monthly adherence,
// and the green tone — so the bar for "met" stays deliberately strict: a 160g
// target must mean 160g adherence, not a drifting 155g. What we soften is the
// *shortfall copy* (see proteinNote), not this threshold.
function proteinFloorTolerance(proteinTarget: number): number {
  return Math.round(roundInt(proteinTarget) * 0.02);
}

export function getProteinResult(
  protein: number,
  proteinTarget: number = DEFAULTS.proteinTarget,
): ProteinResult {
  const p = roundInt(protein);
  const target = roundInt(proteinTarget);
  const gap = Math.max(roundInt(target - p), 0);
  return {
    isPerfect: p === target,
    progress: progressPercent(p, target),
    // Met once within the tolerance band — see proteinFloorTolerance. Drives
    // the green tone + double-hit + "Floor met" note, all at one line.
    celebrated: gap <= proteinFloorTolerance(target),
  };
}

// ── Daily card copy — shared by Overview's Hero card and Nutrition's Today
// card (same underlying daily entry, so the same feedback language). Only
// meaningful once an entry exists; callers gate on `hasEntry` themselves and
// skip rendering when these return "" / null. ──────────────────────────────

export function calorieTone(
  hasEntry: boolean,
  calResult: CalorieResult,
): "good" | "warn" | "bad" | null {
  if (!hasEntry) return null;
  // Four-level verdict scale: on-target green, any deviation amber, working
  // against the phase red. Phase-independent — the states already encode it.
  switch (calResult.state) {
    case "on-plan": return "good";  // 🟢 ●
    case "over": return "warn";     // 🟠 ▲ ate over budget
    case "under": return "warn";    // 🟠 ▼ ate under budget
    case "counter": return "bad";   // 🔴 no deficit on a cut / no surplus on a bulk
  }
}

// Protein is a one-sided floor: the only outcome that matters is whether the
// (completed) day cleared it. Met → green; short → amber (a deviation, same
// tier as an under-eating day — not red, which is reserved for actively
// working against the cut). There is no intraday "not done yet" state: a day
// is logged once, whole, so a shortfall is a settled result, never a pending
// task. Rendered nowhere when there's no entry.
export function proteinTone(
  hasEntry: boolean,
  protResult: ProteinResult,
): "good" | "warn" | null {
  if (!hasEntry) return null;
  return protResult.celebrated ? "good" : "warn"; // 🟢 ● floor met / 🟠 ▼ short
}

export function calorieNote(hasEntry: boolean, calResult: CalorieResult, deficitTarget: number): string {
  if (!hasEntry) return "";
  // The target/unit now rides inline beside the number ("1,886 / 2,078"), so the
  // note drops "kcal" — the deltas read as budget headroom/overage, not a restated
  // unit. "Budget" = the intake target (tdee − signed deficit target), so the
  // over/below arithmetic is the same expression in every phase.
  const signedDelta = calResult.isSurplus ? -calResult.surplus : calResult.deficit;
  if (calResult.state === "counter") {
    // The red read spells out the phase violation, not a budget delta.
    return calResult.phase === "bulk"
      ? "No surplus — below maintenance"
      : `+${calResult.surplus.toLocaleString()} surplus`;
  }
  if (calResult.state === "over") {
    const over = deficitTarget - signedDelta; // intake − budget
    return `${over.toLocaleString()} over budget`;
  }
  if (calResult.state === "on-plan") return "✓ On plan";
  if (calResult.state === "under") {
    // On a cut, a very low day (deficit past ~1.35× target) reads as a recovery
    // caveat rather than a number; a moderate one just shows how far below budget.
    if (calResult.phase === "cut" && deficitTarget > 0 && calResult.deficit > deficitTarget * 1.35) {
      return "Well under budget";
    }
    const below = signedDelta - deficitTarget; // budget − intake
    return `${below.toLocaleString()} below budget`;
  }
  return "";
}

// Protein is a one-sided floor: only the shortfall drives a decision (eat
// more). Above the target there's nothing to act on, so we don't dress
// "over" up as a delta — just how much more, or done.
export function proteinNote(hasEntry: boolean, protNum: number, proteinTarget: number): string {
  if (!hasEntry) return "";
  const target = roundInt(proteinTarget);
  const gap = Math.max(roundInt(target - protNum), 0);
  // Same tolerance band as getProteinResult.celebrated (green + double-hit),
  // so colour and wording never differ: a within-tolerance day just reads as
  // met, with no false-precision "3g to floor" nag.
  if (gap <= proteinFloorTolerance(target)) return "✓ Floor met";
  // Past the floor stays amber (proteinTone → warn), but "met" is the only
  // success event, so the copy softens the miss without dressing it up as done.
  // "close ≠ complete": a near-miss reads as almost there; a genuine shortfall
  // just states the gap. Neither celebrates. Dropping "to floor" ("fell short")
  // keeps a 4g gap from reading as failure.
  const nearMiss = target > 0 && gap <= Math.round(target * 0.05); // within ~5% of the floor
  return nearMiss ? `Almost there · ${gap}g to go` : `${gap}g to go`;
}

// ── Aggregations (weekly trend, monthly adherence) ─────────────────────────

export interface DayInput {
  date: string;
  calories: number | null;
  protein: number | null;
  tdee: number | null;
  deficitTarget: number | null;
  proteinTarget: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

type Consistency = "Building" | "Stable" | "Moderate" | "Variable";

export interface WeeklyStats {
  logged: number;
  avgCalories: number;
  avgProtein: number;
  consistency: Consistency | null;
}

export function weeklyStats(days: DayInput[]): WeeklyStats {
  const logged = days.filter((d) => d.calories != null);
  const cals = logged.map((d) => d.calories as number);
  const prots = logged.filter((d) => d.protein != null).map((d) => d.protein as number);
  const nets = logged.map((d) => (d.tdee ?? DEFAULTS.tdee) - (d.calories as number));

  let consistency: Consistency | null = null;
  if (nets.length > 0 && nets.length < 3) {
    consistency = "Building";
  } else if (nets.length >= 3) {
    const avg = mean(nets);
    const mad = mean(nets.map((n) => Math.abs(n - avg)));
    // MAD of daily net kcal. 250 / 500 are round, hand-picked bands (≈ half a meal /
    // a full meal of day-to-day swing) — not calibrated against outcomes.
    consistency = mad < 250 ? "Stable" : mad < 500 ? "Moderate" : "Variable";
  }

  return {
    logged: logged.length,
    avgCalories: Math.round(mean(cals)),
    avgProtein: Math.round(mean(prots)),
    consistency,
  };
}

// Adherence vs precision are two different questions the month card answers:
//   • Adherence — did you stay inside the phase strategy at all? A deviation
//     IN the phase direction still keeps it: a cut day that undershot the
//     budget ("under" — a bigger deficit) is suboptimal but still moving
//     toward the goal, and a bulk day that overshot ("over" — a bigger
//     surplus) likewise. Only the against-direction deviation and the red
//     "counter" day break adherence. Maintenance has no direction, so only
//     on-plan keeps it.
//   • Precision — of the adherent days, how many landed in the tight target
//     band. That's `onPlan` / the distribution's green block / double-hit.
// So the with-direction warn state counts toward adherencePct + the streak,
// but NOT toward onPlan or double-hit, and it still renders as an amber
// deviation in the distribution.
export const isAdherentState = (s: CalorieState, phase: PhaseKind): boolean =>
  s === "on-plan" || (phase === "cut" ? s === "under" : phase === "bulk" ? s === "over" : false);

export interface MonthlyStats {
  logged: number;
  onPlan: number;
  adherencePct: number;
  doubleHitCount: number;
  doubleHitPct: number;
  currentStreak: number;
  distribution: Record<CalorieState, number>;
}

// Whole-day gap between two YYYY-MM-DD dates, noon-anchored so local getters
// avoid the UTC-midnight day-shift the rest of this file sidesteps.
const daysApart = (a: string, b: string): number =>
  Math.abs(
    Math.round(
      (new Date(a + "T12:00:00").getTime() - new Date(b + "T12:00:00").getTime()) / 86_400_000,
    ),
  );

export function monthlyStats(days: DayInput[]): MonthlyStats {
  const logged = days.filter((d) => d.calories != null);
  const distribution: Record<CalorieState, number> = {
    counter: 0,
    over: 0,
    "on-plan": 0,
    under: 0,
  };
  let onPlan = 0;
  let adherent = 0;
  let doubleHit = 0;

  for (const d of logged) {
    const cal = getCalorieResult(d.calories as number, d.tdee ?? DEFAULTS.tdee, d.deficitTarget ?? DEFAULTS.deficitTarget);
    distribution[cal.state] += 1;
    if (isAdherentState(cal.state, cal.phase)) adherent += 1;
    if (cal.celebrated) {
      onPlan += 1;
      const prot = getProteinResult(d.protein ?? 0, d.proteinTarget ?? DEFAULTS.proteinTarget);
      if (prot.celebrated) doubleHit += 1;
    }
  }

  // Streak: consecutive most-recent CALENDAR days that kept the phase (adherent
  // per the day's own snapshot), matching the adherence definition — days sorted
  // ascending. An unlogged day between two logged rows BREAKS the run: walking
  // only the logged rows would silently jump the gap and report e.g. "3 days"
  // for a run that actually straddles three weeks. A calendar gap > 1 day ends
  // the streak.
  let currentStreak = 0;
  let prevDate: string | null = null;
  for (let i = logged.length - 1; i >= 0; i--) {
    const d = logged[i];
    if (prevDate != null && daysApart(d.date, prevDate) > 1) break;
    const cal = getCalorieResult(d.calories as number, d.tdee ?? DEFAULTS.tdee, d.deficitTarget ?? DEFAULTS.deficitTarget);
    if (!isAdherentState(cal.state, cal.phase)) break;
    currentStreak += 1;
    prevDate = d.date;
  }

  const n = logged.length || 1;
  return {
    logged: logged.length,
    onPlan,
    adherencePct: Math.round((adherent / n) * 100),
    doubleHitCount: doubleHit,
    doubleHitPct: Math.round((doubleHit / n) * 100),
    currentStreak,
    distribution,
  };
}

/** How far back the Overview fetches entries to find the maintenance block's
 *  first day — comfortably past the block's planned 4–6 weeks. */
export const MAINTENANCE_LOOKBACK_DAYS = 60;

/** First day of the CURRENT maintenance block, or null when the latest logged
 *  day isn't at maintenance. Derived, not persisted: every entry snapshots the
 *  day's own deficit_target, so the trailing run of days whose snapshot names
 *  "Maintenance" (same phaseFromDeficit boundary as everywhere else) IS the
 *  block — no schema needed. Feeds the Plan section's "week N of 4–6" read.
 *  Entries must be ascending by date; a null snapshot (pre-snapshot legacy row)
 *  falls back to the default deficit, i.e. reads as cutting. A surplus snapshot
 *  names "Lean Bulk", so a bulk day correctly ends the maintenance block too. */
export function maintenanceStartDate(
  entries: { entry_date: string; deficit_target: number | null }[],
): string | null {
  let start: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const deficit = entries[i].deficit_target ?? DEFAULTS.deficitTarget;
    if (phaseFromDeficit(deficit) !== "Maintenance") break;
    start = entries[i].entry_date;
  }
  return start;
}

// Before this hour, a log defaults to yesterday — you're closing out the day
// that just ended, not starting a new one. 5am assumes you won't log later.
const DAY_ROLLOVER_HOUR = 5;

// Local YYYY-MM-DD, with the pre-dawn rollover applied. Use this ONLY to pick
// which day a fresh form preselects — before 5am it lands on yesterday so you
// can close out the day that just ended.
export function defaultLogDate(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

// The real calendar day, no rollover. Use this for anything that means "today"
// in the UI — the header label, the calendar's today marker, the forward-nav
// edge — so "Today" always points at the actual current day even pre-dawn.
export function calendarToday(now = new Date()): string {
  return toDateStr(new Date(now));
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function trainingMonthsFromStart(
  dateStr: string | null | undefined,
  now = new Date(),
): number | null {
  if (!dateStr) return null;
  // Anchor at local noon so a "YYYY-MM-DD" start date decomposes with local
  // getters without the UTC-midnight day-shift the rest of the codebase avoids.
  const start = new Date(dateStr + "T12:00:00");
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) +
    (now.getDate() - start.getDate()) / 30;
  return Math.max(0, Math.round(months * 10) / 10);
}
