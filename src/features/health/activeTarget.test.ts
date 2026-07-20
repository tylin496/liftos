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

  it("null readings in the previous week are skipped, not zeroed into the sum", () => {
    const v = compute([...days(6, 6, 700), row("2026-07-12", null), ...days(13, 2, 500)]);
    expect(v.carriedFromLastWeek).toBe(700); // 6 × 700 = 4200 vs 3500
  });
});
