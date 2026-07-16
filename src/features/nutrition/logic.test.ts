import { describe, it, expect } from "vitest";
import {
  getCalorieResult,
  getProteinResult,
  phaseFromDeficit,
  phaseKindFromName,
  phaseDirection,
  weightMetricDirection,
  maintenanceStartDate,
  monthlyStats,
  type DayInput,
} from "./logic";

describe("getCalorieResult", () => {
  it("flags a deficit that exactly hits target as perfect on-plan", () => {
    const r = getCalorieResult(2205, 2705, 500);
    expect(r.isSurplus).toBe(false);
    expect(r.deficit).toBe(500);
    expect(r.state).toBe("on-plan");
    expect(r.isPerfect).toBe(true);
    expect(r.status).toBe("Deficit");
    expect(r.progress).toBe(100);
  });

  it("detects a surplus when eating above TDEE", () => {
    const r = getCalorieResult(3000, 2705, 500);
    expect(r.isSurplus).toBe(true);
    expect(r.state).toBe("surplus");
    expect(r.surplus).toBe(295);
    expect(r.status).toBe("Surplus");
  });

  it("classifies an over-budget day (ate too much, deficit fell short)", () => {
    const r = getCalorieResult(2705, 2705, 500);
    expect(r.deficit).toBe(0);
    expect(r.state).toBe("over");
    expect(r.progress).toBe(0);
  });

  it("classifies any under-budget deficit as low-intake (no separate extreme)", () => {
    expect(getCalorieResult(2055, 2705, 500).state).toBe("low-intake"); // ratio 1.3
    expect(getCalorieResult(1905, 2705, 500).state).toBe("low-intake"); // ratio 1.6
  });

  it("treats a zero deficit target as on-plan (maintenance)", () => {
    expect(getCalorieResult(2205, 2705, 0).state).toBe("on-plan");
  });
});

describe("getProteinResult", () => {
  it("is perfect when protein equals target", () => {
    const r = getProteinResult(180, 180);
    expect(r.isPerfect).toBe(true);
    expect(r.progress).toBe(100);
    expect(r.celebrated).toBe(true);
  });

  it("celebrates over the floor too", () => {
    expect(getProteinResult(185, 180).celebrated).toBe(true);
  });

  it("swallows a within-tolerance shortfall (2% band)", () => {
    // 2% of 180 ≈ 4g: gaps inside the estimation noise still count as met, but
    // isPerfect stays exact.
    const r = getProteinResult(176, 180); // 4g short, at the band edge
    expect(r.isPerfect).toBe(false);
    expect(r.celebrated).toBe(true);
    expect(getProteinResult(179, 180).celebrated).toBe(true); // 1g short → met
  });

  it("does not celebrate a real shortfall past the tolerance band", () => {
    expect(getProteinResult(175, 180).celebrated).toBe(false); // 5g short
    expect(getProteinResult(160, 180).celebrated).toBe(false); // 20g short
  });
});

describe("monthlyStats — adherence vs precision", () => {
  // tdee 2705, target 500 → on-plan band is a 375–625 deficit.
  const day = (
    date: string,
    calories: number,
    protein: number,
  ): DayInput => ({
    date,
    calories,
    protein,
    tdee: 2705,
    deficitTarget: 500,
    proteinTarget: 180,
  });

  // 2205 = on-plan (deficit 500) · 2000 = low-intake (deficit 705, ate under)
  // 2500 = over    (deficit 205) · 2800 = surplus (ate above maintenance)
  it("counts low-intake as adherent but not as on-plan or double-hit", () => {
    const m = monthlyStats([
      day("2026-06-01", 2205, 190), // on-plan  + protein met → double hit
      day("2026-06-02", 2000, 190), // low-intake, protein met → adherent, not on-plan
      day("2026-06-03", 2500, 190), // over → NOT adherent
      day("2026-06-04", 2205, 100), // on-plan, protein short → on-plan, not double hit
      day("2026-06-05", 2000, 100), // low-intake → adherent
    ]);
    expect(m.logged).toBe(5);
    expect(m.onPlan).toBe(2); // precision: only the two tight hits
    expect(m.adherencePct).toBe(80); // (2 on-plan + 2 low-intake) / 5
    expect(m.doubleHitCount).toBe(1); // only day 1 (on-plan AND protein)
    expect(m.distribution).toMatchObject({ "on-plan": 2, "low-intake": 2, over: 1, surplus: 0 });
  });

  it("streak keeps counting through low-intake days but breaks on over/surplus", () => {
    const m = monthlyStats([
      day("2026-06-01", 2205, 190), // on-plan
      day("2026-06-02", 2500, 190), // over → breaks anything before it
      day("2026-06-03", 2205, 190), // on-plan
      day("2026-06-04", 2000, 190), // low-intake → still adherent
      day("2026-06-05", 2205, 190), // on-plan (most recent)
    ]);
    expect(m.currentStreak).toBe(3); // days 3,4,5 — the over on day 2 stops it
  });

  it("streak breaks across an unlogged calendar gap, not just a bad day", () => {
    // Three adherent logs but a 9-day hole between the first and the rest. Only
    // the contiguous 06-10/06-11 pair counts — walking logged rows alone would
    // report 3 for a run that actually straddles 11 calendar days.
    const m = monthlyStats([
      day("2026-06-01", 2205, 190),
      day("2026-06-10", 2205, 190),
      day("2026-06-11", 2205, 190), // most recent
    ]);
    expect(m.currentStreak).toBe(2);
  });

  it("surplus breaks the streak immediately", () => {
    const m = monthlyStats([
      day("2026-06-01", 2205, 190),
      day("2026-06-02", 2800, 190), // surplus (most recent) → streak 0
    ]);
    expect(m.currentStreak).toBe(0);
  });
});

describe("phaseFromDeficit", () => {
  it("maps deficit size to a phase label", () => {
    expect(phaseFromDeficit(100)).toBe("Maintenance");
    expect(phaseFromDeficit(300)).toBe("Cruise");
    expect(phaseFromDeficit(600)).toBe("Moderate Cut");
    expect(phaseFromDeficit(900)).toBe("Aggressive Cut");
  });

  it("names a surplus of 100+ Lean Bulk; smaller surpluses stay in the maintenance deadband", () => {
    expect(phaseFromDeficit(-100)).toBe("Lean Bulk");
    expect(phaseFromDeficit(-500)).toBe("Lean Bulk");
    expect(phaseFromDeficit(-99)).toBe("Maintenance");
    expect(phaseFromDeficit(0)).toBe("Maintenance");
  });
});

describe("phase kind & polarity", () => {
  it("classifies phase names into kinds", () => {
    expect(phaseKindFromName("Lean Bulk")).toBe("bulk");
    expect(phaseKindFromName("Maintenance")).toBe("maintenance");
    expect(phaseKindFromName("Cruise")).toBe("cut");
    expect(phaseKindFromName("Moderate Cut")).toBe("cut");
    expect(phaseKindFromName("Aggressive Cut")).toBe("cut");
  });

  it("derives scale direction and weight-metric polarity from the kind", () => {
    expect(phaseDirection("bulk")).toBe(1);
    expect(phaseDirection("cut")).toBe(-1);
    expect(phaseDirection("maintenance")).toBe(-1);
    expect(weightMetricDirection("bulk")).toBe("up-good");
    expect(weightMetricDirection("cut")).toBe("down-good");
  });
});

describe("maintenanceStartDate", () => {
  const day = (entry_date: string, deficit_target: number | null) => ({ entry_date, deficit_target });

  it("returns the first day of the trailing maintenance run", () => {
    const entries = [
      day("2026-07-01", 500),
      day("2026-07-02", 500),
      day("2026-07-03", 150), // block starts here
      day("2026-07-04", 150),
      day("2026-07-05", 100),
    ];
    expect(maintenanceStartDate(entries)).toBe("2026-07-03");
  });

  it("null while the latest logged day is still cutting", () => {
    expect(maintenanceStartDate([day("2026-07-01", 150), day("2026-07-02", 500)])).toBeNull();
  });

  it("an earlier maintenance stint doesn't leak into the current block", () => {
    const entries = [
      day("2026-06-01", 150), // old diet break
      day("2026-06-02", 500),
      day("2026-06-03", 150),
    ];
    expect(maintenanceStartDate(entries)).toBe("2026-06-03");
  });

  it("a null snapshot (legacy row) reads as cutting via the default deficit", () => {
    expect(maintenanceStartDate([day("2026-07-01", null)])).toBeNull();
    expect(maintenanceStartDate([day("2026-07-01", null), day("2026-07-02", 150)])).toBe("2026-07-02");
  });

  it("empty log → null", () => {
    expect(maintenanceStartDate([])).toBeNull();
  });
});
