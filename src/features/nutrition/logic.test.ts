import { describe, it, expect } from "vitest";
import {
  getCalorieResult,
  getProteinResult,
  fatLossKg,
  formatFatLossKg,
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

  it("classifies an under-eating-vs-target day", () => {
    const r = getCalorieResult(2705, 2705, 500);
    expect(r.deficit).toBe(0);
    expect(r.state).toBe("under");
    expect(r.progress).toBe(0);
  });

  it("classifies 'over' and 'extreme' deficits", () => {
    expect(getCalorieResult(2055, 2705, 500).state).toBe("over"); // ratio 1.3
    expect(getCalorieResult(1905, 2705, 500).state).toBe("extreme"); // ratio 1.6
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

  it("celebrates within 10% of target but not perfect", () => {
    const r = getProteinResult(170, 180); // gap 10 <= 18
    expect(r.isPerfect).toBe(false);
    expect(r.celebrated).toBe(true);
  });

  it("does not celebrate when well short", () => {
    const r = getProteinResult(160, 180); // gap 20 > 18
    expect(r.celebrated).toBe(false);
    expect(r.progress).toBe(89); // round(160/180)
  });
});

describe("fatLossKg", () => {
  it("converts a deficit to kg at 7700 kcal/kg", () => {
    expect(fatLossKg(7700)).toBe(1);
    expect(fatLossKg(3850)).toBe(0.5);
  });

  it("clamps negative (surplus) totals to zero", () => {
    expect(fatLossKg(-1000)).toBe(0);
  });
});

describe("formatFatLossKg", () => {
  it("formats by magnitude band", () => {
    expect(formatFatLossKg(0)).toBe("0");
    expect(formatFatLossKg(0.5)).toBe("0.50");
    expect(formatFatLossKg(2.34)).toBe("2.3");
    expect(formatFatLossKg(12.3)).toBe("12");
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
