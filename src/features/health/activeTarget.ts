import { localDateStr } from "@shared/lib/date";

/** Minimal metric shape needed to derive the active-calorie target. */
export interface ActiveTargetRow {
  metric_date: string;
  active_energy_kcal: number | null;
  exercise_minutes: number | null;
}

export interface ActiveTargetView {
  /** Daily active-calorie goal = target TDEE − resting (30-day avg). */
  activeTargetPerDay: number;
  /** Resting energy the target subtracts (30-day avg). */
  restingAvg: number;
  /** The user-set TDEE goal this is derived from. */
  targetTdee: number;

  /** This-week pace, Monday → today (local). */
  week: {
    /** Sum of active energy logged Mon→today. */
    accrued: number;
    /** Calendar days elapsed this week (Mon=1 … Sun=7). */
    daysElapsed: number;
    /** Days this week that actually have an active reading. */
    daysWithData: number;
    /** Average active/day over COMPLETED days (Mon→yesterday), unsynced days
     *  counted as 0 — same zero-fill assumption as today's floating target,
     *  and no dilution from today's partial reading. null on Monday. */
    avgSoFar: number | null;
    /** How far below target the average sits, per day (+ = behind). */
    shortPerDay: number | null;
    /** Active/day needed across the remaining days to still average the target. */
    neededPerRemaining: number | null;
    /** Days left in the week after today. */
    remainingDays: number;
    /** Pace check: completed days have banked at least target × days. */
    onTrack: boolean;
  };

  /** What a training day is worth, from recent history. null when we can't tell. */
  session: {
    /** Extra active on training days vs rest days (kcal). */
    boost: number;
    /** Training days needed in the remaining week to close the gap (0 = none). */
    workoutsNeeded: number;
  } | null;

  /** Today's floating target — the ring. Rises/falls with the rest of the
   *  week's pace so far, so a banked surplus quietly lowers today's ask and a
   *  shortfall raises it. This is what makes the ring mean something. */
  today: {
    /** Active/day needed today to keep the week on pace for the target. */
    target: number;
    /** Active logged so far today (0 if not synced yet). */
    accrued: number;
    /** Whether today has a synced active reading at all. */
    synced: boolean;
    /** Most recent date with any active reading — for a staleness note when
     *  `synced` is false. */
    lastSyncDate: string | null;
  };
}

const TRAIN_MIN_MINUTES = 20; // a day counts as "trained" at ≥20 exercise minutes
const SESSION_WINDOW_DAYS = 30;

function startOfWeekISO(todayISO: string): { mondayISO: string; weekday: number } {
  // weekday: Mon=1 … Sun=7, matching the "days elapsed" mental model.
  const d = new Date(`${todayISO}T00:00:00`);
  const js = d.getDay(); // Sun=0 … Sat=6
  const weekday = js === 0 ? 7 : js;
  const monday = new Date(d);
  monday.setDate(d.getDate() - (weekday - 1));
  // localDateStr, NOT toISOString: the latter converts local midnight to UTC,
  // which in UTC+ timezones lands on the previous calendar day — the week
  // filter would silently include last Sunday.
  return { mondayISO: localDateStr(monday), weekday };
}

/**
 * Derive the daily active-calorie target from a maintenance TDEE goal, plus a
 * this-week pace tracker and a training-day contribution estimate. Pure — the
 * Health card renders whatever the latest synced metrics produce, so it stays
 * current without any stored state. Returns null when there's no resting
 * baseline yet (target can't be computed) or no target is set.
 */
export function computeActiveTarget(
  metrics: ActiveTargetRow[],
  targetTdee: number | null,
  restingAvg: number | null,
): ActiveTargetView | null {
  if (targetTdee == null || restingAvg == null) return null;

  const activeTargetPerDay = Math.max(0, Math.round(targetTdee - restingAvg));

  const todayISO = localDateStr();
  const { mondayISO, weekday } = startOfWeekISO(todayISO);
  const daysElapsed = weekday;
  const remainingDays = 7 - daysElapsed;

  const thisWeek = metrics.filter(
    (m) => m.metric_date >= mondayISO && m.metric_date <= todayISO && m.active_energy_kcal != null,
  );
  const accrued = thisWeek.reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);
  const daysWithData = thisWeek.length;
  const accruedThroughYesterday = thisWeek
    .filter((m) => m.metric_date < todayISO)
    .reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);
  // Pace over COMPLETED days only, missing days = 0: today's partial reading
  // would dilute the average, and skipping unsynced days would tell a rosier
  // story than the floating target (which treats them as 0) tells the ring.
  const completedDays = weekday - 1;
  const avgSoFar = completedDays > 0 ? Math.round(accruedThroughYesterday / completedDays) : null;
  const shortPerDay = avgSoFar != null ? Math.round(activeTargetPerDay - avgSoFar) : null;

  const weeklyGoalTotal = activeTargetPerDay * 7;
  const neededPerRemaining =
    remainingDays > 0 ? Math.max(0, Math.round((weeklyGoalTotal - accrued) / remainingDays)) : null;
  const onTrack = accruedThroughYesterday >= activeTargetPerDay * completedDays;

  // Training-day contribution: average active on trained vs rest days over the
  // recent window. Only meaningful with a couple of each kind on record.
  const windowStart = localDateStrDaysAgo(SESSION_WINDOW_DAYS, todayISO);
  const recent = metrics.filter(
    (m) => m.metric_date >= windowStart && m.active_energy_kcal != null && m.exercise_minutes != null,
  );
  const trained = recent.filter((m) => (m.exercise_minutes ?? 0) >= TRAIN_MIN_MINUTES);
  const rest = recent.filter((m) => (m.exercise_minutes ?? 0) < TRAIN_MIN_MINUTES);

  let session: ActiveTargetView["session"] = null;
  if (trained.length >= 2 && rest.length >= 2) {
    const trainedAvg = trained.reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0) / trained.length;
    const restAvg = rest.reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0) / rest.length;
    const boost = Math.round(trainedAvg - restAvg);
    if (boost > 0) {
      // If the rest of the week ran at rest-day activity, how many training days
      // would it take to still hit the weekly total?
      const baselineRemaining = restAvg * remainingDays;
      const deficit = weeklyGoalTotal - accrued - baselineRemaining;
      const workoutsNeeded =
        deficit > 0 ? Math.min(remainingDays, Math.ceil(deficit / boost)) : 0;
      session = { boost, workoutsNeeded };
    }
  }

  // Today's floating target: what's left of the weekly goal, spread across
  // today + the days after it. Banking active on prior days lowers this;
  // falling behind raises it — the number the ring is actually built on.
  const daysRemainingInclToday = 8 - weekday;
  const todayTarget = Math.max(
    0,
    Math.round((weeklyGoalTotal - accruedThroughYesterday) / daysRemainingInclToday),
  );
  const todayRow = metrics.find((m) => m.metric_date === todayISO);
  const todaySynced = todayRow?.active_energy_kcal != null;
  const todayAccrued = todayRow?.active_energy_kcal ?? 0;
  const lastSyncDate =
    metrics
      .filter((m) => m.active_energy_kcal != null)
      .map((m) => m.metric_date)
      .sort()
      .at(-1) ?? null;

  return {
    activeTargetPerDay,
    restingAvg,
    targetTdee,
    week: {
      accrued: Math.round(accrued),
      daysElapsed,
      daysWithData,
      avgSoFar,
      shortPerDay,
      neededPerRemaining,
      remainingDays,
      onTrack,
    },
    session,
    today: {
      target: todayTarget,
      accrued: Math.round(todayAccrued),
      synced: todaySynced,
      lastSyncDate,
    },
  };
}

function localDateStrDaysAgo(days: number, fromISO: string): string {
  const d = new Date(`${fromISO}T00:00:00`);
  d.setDate(d.getDate() - days);
  // Same toISOString-vs-local pitfall as startOfWeekISO above.
  return localDateStr(d);
}
