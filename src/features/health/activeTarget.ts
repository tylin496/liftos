import { localDateStr } from "@shared/lib/date";

/** Minimal metric shape needed to derive the active-calorie target. */
export interface ActiveTargetRow {
  metric_date: string;
  active_energy_kcal: number | null;
}

export interface ActiveTargetView {
  /** Daily active-calorie goal = target TDEE − resting (30-day avg). */
  activeTargetPerDay: number;
  /** Resting energy the target subtracts (30-day avg). */
  restingAvg: number;
  /** The user-set TDEE goal this is derived from. */
  targetTdee: number;

  /** Mon-start week bounds for today (weekday: Mon=1…Sun=7) — lets callers
   *  (the Overview week strip) slice the same metrics rows this computation
   *  used, without re-deriving the week-start logic. */
  mondayISO: string;
  weekday: number;
  /** Active banked through yesterday this week (excludes today's partial
   *  reading) — same figure the floating target is computed from, exposed
   *  for the week-strip footer's banked/short readout. */
  accruedThroughYesterday: number;

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
 * Derive today's floating active-calorie target from a maintenance TDEE goal:
 * this week's shortfall/surplus so far is folded into the days remaining
 * (including today), so a banked surplus eases today's ask and a shortfall
 * raises it. Pure — the Health card renders whatever the latest synced
 * metrics produce, so it stays current without any stored state. Returns
 * null when there's no resting baseline yet (target can't be computed) or no
 * target is set.
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

  // Only "through yesterday" — today's partial reading isn't banked yet, it's
  // what the floating target below is asking for.
  const accruedThroughYesterday = metrics
    .filter(
      (m) =>
        m.metric_date >= mondayISO && m.metric_date < todayISO && m.active_energy_kcal != null,
    )
    .reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);

  // Today's floating target: what's left of the weekly goal, spread across
  // today + the days after it. Banking active on prior days lowers this;
  // falling behind raises it — the number the ring is actually built on.
  const weeklyGoalTotal = activeTargetPerDay * 7;
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
    mondayISO,
    weekday,
    accruedThroughYesterday: Math.round(accruedThroughYesterday),
    today: {
      target: todayTarget,
      accrued: Math.round(todayAccrued),
      synced: todaySynced,
      lastSyncDate,
    },
  };
}
