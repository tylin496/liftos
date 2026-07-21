import { describe, it, expect } from "vitest";
import { estimateTdee, computeTdeeWindows, type TdeeMetricRow } from "./tdee";

describe("estimateTdee", () => {
  it("sums averaged resting + active energy", () => {
    const r = estimateTdee(
      [{ resting: 1700 }, { resting: 1700 }],
      [{ active: 600 }, { active: 600 }],
    );
    expect(r.avgResting).toBe(1700);
    expect(r.avgActive).toBe(600);
    expect(r.tdee).toBe(2300);
    expect(r.restingDays).toBe(2);
    expect(r.activeDays).toBe(2);
  });

  it("ignores null readings when averaging", () => {
    const r = estimateTdee(
      [{ resting: null }, { resting: 1600 }],
      [{ active: 500 }],
    );
    expect(r.avgResting).toBe(1600);
    expect(r.restingDays).toBe(1);
    expect(r.tdee).toBe(2100);
  });

  it("rounds averages to whole kcal", () => {
    const r = estimateTdee([{ resting: 1700 }, { resting: 1701 }], [{ active: 600 }]);
    expect(r.avgResting).toBe(1701); // 1700.5 rounds up
  });

  it("returns null tdee when either side has no data", () => {
    expect(estimateTdee([], [{ active: 600 }]).tdee).toBeNull();
    expect(estimateTdee([{ resting: 1700 }], []).tdee).toBeNull();
  });
});

describe("computeTdeeWindows", () => {
  const iso = (daysAgo: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  };

  it("returns null estimates for no metrics", () => {
    const { tdee, tdeePrev } = computeTdeeWindows([]);
    expect(tdee.tdee).toBeNull();
    expect(tdeePrev.tdee).toBeNull();
  });

  it("separates current (30d/14d) from previous (30-60d/14-28d) windows", () => {
    const metrics: TdeeMetricRow[] = [
      // Current windows (recent): resting in 30d, active in 14d
      { metric_date: iso(3), resting_energy_kcal: 1700, active_energy_kcal: 600 },
      { metric_date: iso(7), resting_energy_kcal: 1700, active_energy_kcal: 600 },
      // Previous active window only (14–28d ago)
      { metric_date: iso(20), resting_energy_kcal: null, active_energy_kcal: 500 },
      { metric_date: iso(22), resting_energy_kcal: null, active_energy_kcal: 500 },
      // Previous resting window only (30–60d ago)
      { metric_date: iso(40), resting_energy_kcal: 1600, active_energy_kcal: null },
      { metric_date: iso(45), resting_energy_kcal: 1600, active_energy_kcal: null },
    ];
    const { tdee, tdeePrev } = computeTdeeWindows(metrics);

    expect(tdee.avgResting).toBe(1700);
    expect(tdee.avgActive).toBe(600);
    expect(tdee.tdee).toBe(2300);

    expect(tdeePrev.avgResting).toBe(1600);
    expect(tdeePrev.avgActive).toBe(500);
    expect(tdeePrev.tdee).toBe(2100);
  });

  it("excludes step-estimated active days from both windows", () => {
    const metrics: TdeeMetricRow[] = [
      { metric_date: iso(3), resting_energy_kcal: 1700, active_energy_kcal: 600 },
      { metric_date: iso(7), resting_energy_kcal: 1700, active_energy_kcal: 600 },
      // Watch off — step fallback wrote 240. Counts in weekly totals, never here.
      { metric_date: iso(9), resting_energy_kcal: null, active_energy_kcal: 240, active_energy_estimated: true },
      { metric_date: iso(20), resting_energy_kcal: null, active_energy_kcal: 500 },
      { metric_date: iso(22), resting_energy_kcal: null, active_energy_kcal: 500 },
      { metric_date: iso(24), resting_energy_kcal: null, active_energy_kcal: 200, active_energy_estimated: true },
      // Prev resting window (30–60d) — estimateTdee nulls the whole estimate
      // when either window is empty, so tdeePrev needs resting data to report.
      { metric_date: iso(40), resting_energy_kcal: 1600, active_energy_kcal: null },
    ];
    const { tdee, tdeePrev } = computeTdeeWindows(metrics);

    expect(tdee.avgActive).toBe(600);
    expect(tdee.activeDays).toBe(2);
    expect(tdeePrev.avgActive).toBe(500);
    expect(tdeePrev.activeDays).toBe(2);
  });
});
