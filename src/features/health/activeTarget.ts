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
  /** Last week's surplus carried into this week (≥0). Surplus only — a short
   *  week starts the next one clean — and one week of memory: it's measured
   *  from last week's RAW total vs the flat goal, so credit spent (or unused)
   *  last week doesn't compound forward. */
  carriedFromLastWeek: number;
  /** Days Mon→yesterday that have an active reading. The week's goal is scaled
   *  to these, not to the calendar — see missedDays. */
  syncedPastDays: number;
  /** Elapsed days this week with no reading at all. Excluded from both sides of
   *  the week's accounting: a day we didn't measure is neither credit nor debt.
   *  Consumers comparing a total against a goal must scale by the days actually
   *  covered, or an unsynced day reads as a day of doing nothing. */
  missedDays: number;

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
  const syncedPast = metrics.filter(
    (m) => m.metric_date >= mondayISO && m.metric_date < todayISO && m.active_energy_kcal != null,
  );
  const accruedThroughYesterday = syncedPast.reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);

  // Days this week we have NO reading for at all — the sync didn't run, so we
  // know nothing about them. They must leave the week's accounting entirely
  // rather than count as zero: a day with no data is not a day with no
  // movement. Holding the week's goal at 7 days while the numerator silently
  // loses one is the same debt-snowball the surplus-only carry below exists to
  // prevent, except invisible — one missed sync would quietly raise every
  // remaining day's ask for the rest of the week.
  const daysElapsed = weekday - 1;
  const missedDays = Math.max(0, daysElapsed - syncedPast.length);

  // Last week's surplus rolls forward as credit against this week's goal.
  // Surplus only (a shortfall doesn't raise this week's ask — debt snowballs
  // into abandonment), and against the CURRENT per-day goal (resting drifts a
  // few kcal week to week; re-deriving last week's exact goal isn't worth it).
  const prevMondayISO = localDateStr(
    new Date(new Date(`${mondayISO}T12:00:00`).getTime() - 7 * 86400000),
  );
  const lastWeekSynced = metrics.filter(
    (m) =>
      m.metric_date >= prevMondayISO && m.metric_date < mondayISO && m.active_energy_kcal != null,
  );
  const lastWeekTotal = lastWeekSynced.reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);
  // Judged against the days last week we actually measured, for the same reason
  // as missedDays above — an unsynced day must not manufacture a phantom
  // shortfall that silently cancels a real surplus.
  const carriedFromLastWeek = Math.max(
    0,
    Math.round(lastWeekTotal - activeTargetPerDay * lastWeekSynced.length),
  );

  // Today's floating target: what's left of the weekly goal, spread across
  // today + the days after it. Banking active on prior days lowers this;
  // falling behind raises it — the number the ring is actually built on. The
  // goal covers only the days we can account for: 7 minus the ones with no
  // reading (see missedDays).
  const weeklyGoalTotal = activeTargetPerDay * (7 - missedDays);
  const daysRemainingInclToday = 8 - weekday;
  const todayTarget = Math.max(
    0,
    Math.round(
      (weeklyGoalTotal - carriedFromLastWeek - accruedThroughYesterday) / daysRemainingInclToday,
    ),
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
    carriedFromLastWeek,
    syncedPastDays: syncedPast.length,
    missedDays,
    today: {
      target: todayTarget,
      accrued: Math.round(todayAccrued),
      synced: todaySynced,
      lastSyncDate,
    },
  };
}
