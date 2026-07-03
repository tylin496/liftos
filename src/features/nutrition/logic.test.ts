import { describe, it, expect } from "vitest";
import {
  getCalorieResult,
  getProteinResult,
  phaseFromDeficit,
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

  it("does not celebrate below the full floor — no grace", () => {
    // A floor only counts once you hit it: even 1g short is not met.
    const r = getProteinResult(179, 180);
    expect(r.isPerfect).toBe(false);
    expect(r.celebrated).toBe(false);
    expect(getProteinResult(160, 180).celebrated).toBe(false);
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
});
