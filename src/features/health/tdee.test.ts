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

  it("separates the most recent N readings (current) from the N before (previous)", () => {
    // 60 daily rows, oldest → newest. Reading-count windows: current resting =
    // newest 30, previous = the 30 before; current active = newest 14, prev = 14
    // before. Values chosen so current vs previous averages are distinct.
    const rows: TdeeMetricRow[] = [];
    for (let i = 0; i < 60; i++) {
      // i = 0 is the oldest (60d ago), i = 59 the newest (1d ago).
      rows.push({
        metric_date: iso(60 - i),
        resting_energy_kcal: i < 30 ? 1600 : 1700, // newest 30 = 1700
        active_energy_kcal: i < 46 ? 500 : 600,     // newest 14 = 600
      });
    }
    const { tdee, tdeePrev } = computeTdeeWindows(rows);

    expect(tdee.avgResting).toBe(1700);
    expect(tdee.avgActive).toBe(600);
    expect(tdee.tdee).toBe(2300);
    expect(tdee.restingDays).toBe(30);
    expect(tdee.activeDays).toBe(14);

    expect(tdeePrev.avgResting).toBe(1600);
    expect(tdeePrev.avgActive).toBe(500);
    expect(tdeePrev.tdee).toBe(2100);
  });

  it("reaches past gaps so a missing day doesn't shrink the window below 30", () => {
    // Exactly 30 resting readings, but scattered over 40 calendar days (10 gap
    // days with no reading, plus today unsynced). Still a full 30-reading avg.
    const rows: TdeeMetricRow[] = [];
    for (let i = 0; i < 30; i++) {
      // Spread across ~40 days by skipping some; newest is 2 days ago (today unsynced).
      rows.push({
        metric_date: iso(2 + Math.floor(i * 1.3)),
        resting_energy_kcal: 1700,
        active_energy_kcal: 600,
      });
    }
    const { tdee } = computeTdeeWindows(rows);
    expect(tdee.restingDays).toBe(30); // not 29 — reached back over the gaps
    expect(tdee.avgResting).toBe(1700);
  });
});
