import { describe, it, expect } from "vitest";
import {
  getCalorieResult,
  getProteinResult,
  phaseFromDeficit,
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

describe("phaseFromDeficit", () => {
  it("maps deficit size to a phase label", () => {
    expect(phaseFromDeficit(100)).toBe("Maintenance");
    expect(phaseFromDeficit(300)).toBe("Cruise");
    expect(phaseFromDeficit(600)).toBe("Moderate Cut");
    expect(phaseFromDeficit(900)).toBe("Aggressive Cut");
  });
});
