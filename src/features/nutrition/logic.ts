// Nutrition business logic — ported faithfully from legacy/nutrition/app.js.
// Pure, typed, framework-free so it is trivial to test and reuse.

export const DEFAULTS = {
  tdee: 2705,
  proteinTarget: 180,
  deficitTarget: 500,
} as const;

export function phaseFromDeficit(deficit: number): string {
  if (deficit < 200) return "Maintenance";
  if (deficit < 500) return "Cruise";
  if (deficit < 800) return "Moderate Cut";
  return "Aggressive Cut";
}

export type CalorieState = "surplus" | "under" | "on-plan" | "over" | "extreme";

export interface CalorieResult {
  deficit: number;
  surplus: number;
  isSurplus: boolean;
  isPerfect: boolean;
  state: CalorieState;
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
  const rawDelta = roundInt(tdee - calories);
  const isSurplus = rawDelta < 0;
  const deficit = Math.max(rawDelta, 0);
  const surplus = Math.max(-rawDelta, 0);
  const target = roundInt(deficitTarget);

  let state: CalorieState;
  if (isSurplus) {
    state = "surplus";
  } else if (target === 0) {
    state = "on-plan";
  } else {
    const ratio = deficit / target;
    if (ratio < 0.75) state = "under";
    else if (ratio <= 1.25) state = "on-plan";
    else if (ratio <= 1.35) state = "over";
    else state = "extreme";
  }

  return {
    deficit,
    surplus,
    isSurplus,
    isPerfect: state === "on-plan" && deficit === target,
    state,
    celebrated: state === "on-plan",
    progress: state === "under" ? progressPercent(deficit, target) : 100,
    status: isSurplus ? "Surplus" : "Deficit",
  };
}

export interface ProteinResult {
  isPerfect: boolean;
  progress: number;
  celebrated: boolean;
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
    celebrated: gap <= target * 0.1,
  };
}

// ── Daily card copy — shared by Overview's Hero card and Nutrition's Today
// card (same underlying daily entry, so the same feedback language). Only
// meaningful once an entry exists; callers gate on `hasEntry` themselves and
// skip rendering when these return "" / null. ──────────────────────────────

export function calorieTone(hasEntry: boolean, calResult: CalorieResult): "good" | "bad" | null {
  if (!hasEntry) return null;
  if (calResult.isSurplus || calResult.state === "extreme") return "bad";
  if (calResult.state === "on-plan" || calResult.state === "under") return "good";
  if (calResult.state === "over") return "bad";
  return null;
}

export function calorieNote(hasEntry: boolean, calResult: CalorieResult, deficitTarget: number): string {
  if (!hasEntry) return "";
  if (calResult.isSurplus) return `+${calResult.surplus.toLocaleString()} kcal surplus`;
  if (calResult.state === "under") {
    const short = deficitTarget - calResult.deficit;
    return `${short.toLocaleString()} kcal short`;
  }
  if (calResult.state === "on-plan") return "✓ On Plan";
  if (calResult.state === "over") {
    const below = calResult.deficit - deficitTarget;
    return `${below.toLocaleString()} kcal below budget`;
  }
  if (calResult.state === "extreme") return "Well below target";
  return "";
}

// Protein is a one-sided floor: only the shortfall drives a decision (eat
// more). Above the target there's nothing to act on, so we don't dress
// "over" up as a delta — just how much more, or done.
export function proteinNote(hasEntry: boolean, protNum: number, proteinTarget: number): string {
  if (!hasEntry) return "";
  const gap = proteinTarget - protNum;
  return gap > 0 ? `${gap}g to go` : "✓ Target met";
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

export type Consistency = "Building" | "Stable" | "Moderate" | "Variable";

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
    consistency = mad < 250 ? "Stable" : mad < 500 ? "Moderate" : "Variable";
  }

  return {
    logged: logged.length,
    avgCalories: Math.round(mean(cals)),
    avgProtein: Math.round(mean(prots)),
    consistency,
  };
}

export interface MonthlyStats {
  logged: number;
  onPlan: number;
  adherencePct: number;
  doubleHitCount: number;
  doubleHitPct: number;
  currentStreak: number;
  distribution: Record<CalorieState, number>;
}

export function monthlyStats(days: DayInput[]): MonthlyStats {
  const logged = days.filter((d) => d.calories != null);
  const distribution: Record<CalorieState, number> = {
    surplus: 0,
    under: 0,
    "on-plan": 0,
    over: 0,
    extreme: 0,
  };
  let onPlan = 0;
  let doubleHit = 0;

  for (const d of logged) {
    const cal = getCalorieResult(d.calories as number, d.tdee ?? DEFAULTS.tdee, d.deficitTarget ?? DEFAULTS.deficitTarget);
    distribution[cal.state] += 1;
    if (cal.celebrated) {
      onPlan += 1;
      const prot = getProteinResult(d.protein ?? 0, d.proteinTarget ?? DEFAULTS.proteinTarget);
      if (prot.celebrated) doubleHit += 1;
    }
  }

  // Streak: consecutive most-recent on-plan days (days sorted ascending).
  let currentStreak = 0;
  for (let i = logged.length - 1; i >= 0; i--) {
    const d = logged[i];
    const cal = getCalorieResult(d.calories as number, d.tdee ?? DEFAULTS.tdee, d.deficitTarget ?? DEFAULTS.deficitTarget);
    if (cal.celebrated) currentStreak += 1;
    else break;
  }

  const n = logged.length || 1;
  return {
    logged: logged.length,
    onPlan,
    adherencePct: Math.round((onPlan / n) * 100),
    doubleHitCount: doubleHit,
    doubleHitPct: Math.round((doubleHit / n) * 100),
    currentStreak,
    distribution,
  };
}

// Local YYYY-MM-DD. Before 6am we default to yesterday — you log the previous
// day's intake in the morning (matches the legacy app's behaviour).
export function defaultLogDate(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return toDateStr(d);
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
  const start = new Date(dateStr);
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) +
    (now.getDate() - start.getDate()) / 30;
  return Math.max(0, Math.round(months * 10) / 10);
}
