import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { computeActiveTarget } from "./activeTarget";

// Freeze the clock at Wed 2026-07-15 → week is Mon 2026-07-13, weekday 3,
// previous week 2026-07-06 … 2026-07-12.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T10:00:00"));
});
afterAll(() => vi.useRealTimers());

const row = (metric_date: string, active_energy_kcal: number | null) => ({
  metric_date,
  active_energy_kcal,
});

/** N daily rows of `kcal` starting at startISO (July dates only — test-local). */
const days = (startDay: number, n: number, kcal: number) =>
  Array.from({ length: n }, (_, i) => row(`2026-07-${String(startDay + i).padStart(2, "0")}`, kcal));

// targetTdee 2500 − resting 2000 → 500/day, 3500/week.
const compute = (metrics: { metric_date: string; active_energy_kcal: number | null }[]) =>
  computeActiveTarget(metrics, 2500, 2000)!;

describe("computeActiveTarget — last-week carry", () => {
  it("an exactly-met previous week carries nothing (target unchanged)", () => {
    const v = compute([...days(6, 7, 500), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(0);
    // (3500 − 1000) / 5 remaining days
    expect(v.today.target).toBe(500);
  });

  it("a previous-week surplus carries in full and eases this week's ask", () => {
    const v = compute([...days(6, 7, 600), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(700); // 4200 − 3500
    // (3500 − 700 − 1000) / 5
    expect(v.today.target).toBe(360);
  });

  it("a previous-week shortfall does NOT carry — the new week starts clean", () => {
    const v = compute([...days(6, 7, 300), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(0);
    expect(v.today.target).toBe(500);
  });

  it("a large enough carry can close the week (target floors at 0)", () => {
    const v = compute([...days(6, 7, 1500), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(7000);
    expect(v.today.target).toBe(0);
  });

  it("an unsynced previous-week day leaves BOTH sides of the carry", () => {
    // 6 days × 700 = 4200 measured, judged against 6 × 500 = 3000 → 1200 carried.
    // Charging the unmeasured 7th day (4200 vs 3500 → 700) would delete 500 kcal
    // of real surplus purely because a sync didn't run.
    const v = compute([...days(6, 6, 700), row("2026-07-12", null), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(1200);
  });
});

describe("computeActiveTarget — unsynced days", () => {
  // Clock is Wed 2026-07-15: Mon 13 and Tue 14 have elapsed.
  it("a missed sync does not raise the remaining days' ask", () => {
    // Only Tuesday synced. The week's goal covers the 6 days we can account for
    // (3000), not 7 — so the ask holds at the flat 500 instead of jumping to 600
    // the way a zeroed Monday would make it.
    const v = compute([row("2026-07-14", 500)]);
    expect(v.missedDays).toBe(1);
    expect(v.syncedPastDays).toBe(1);
    expect(v.today.target).toBe(500); // (3000 − 500) / 5
  });

  it("a row that exists with no reading counts as missed, same as no row", () => {
    const v = compute([row("2026-07-13", null), row("2026-07-14", 500)]);
    expect(v.missedDays).toBe(1);
    expect(v.today.target).toBe(500);
  });

  it("a real shortfall still raises the ask — only unmeasured days are excused", () => {
    // Both days synced, both low. Nothing is missing, so the week stays a 7-day
    // goal and the deficit lands where it should.
    const v = compute([...days(13, 2, 100)]);
    expect(v.missedDays).toBe(0);
    expect(v.today.target).toBe(660); // (3500 − 200) / 5
  });

  it("a fully unsynced week asks the flat daily target, never a pile-up", () => {
    const v = compute([]);
    expect(v.missedDays).toBe(2);
    expect(v.today.target).toBe(500); // (2500 − 0) / 5
  });
});
