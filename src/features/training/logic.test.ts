import { describe, it, expect } from "vitest";
import { epley1RM, cmpStrength, classifyPR } from "./logic";

// Minimal CmpFields builder — the four axes cmpStrength/classifyPR read.
const set = (e1rm: number, tonnage: number, weightKg = 0, totalReps = 0) => ({
  e1rm,
  tonnage,
  weightKg,
  totalReps,
});

describe("epley1RM — high-rep cap", () => {
  it("estimates normally at or below 12 reps", () => {
    expect(epley1RM(100, "10")).toBeCloseTo(133.3, 1); // 100 × (1 + 10/30)
    expect(epley1RM(60, "12")).toBeCloseTo(84, 1); // 60 × (1 + 12/30)
  });

  it("clamps reps past 12 so a burnout set can't mint a phantom PR", () => {
    // 68×15 would be 102 uncapped (the real Leg Curl phantom ceiling); capped at
    // 12 it estimates the same as 68×12 — a number working sets can actually beat.
    expect(epley1RM(68, "15")).toBeCloseTo(95.2, 1);
    expect(epley1RM(68, "15")).toBe(epley1RM(68, "12"));
  });

  it("uses the max rep across drop-set segments before clamping", () => {
    // maxReps("15/12/10") = 15 → clamped to 12 → same as a straight 12.
    expect(epley1RM(68, "15/12/10")).toBe(epley1RM(68, "12"));
  });

  it("returns 0 for empty or zero-weight input", () => {
    expect(epley1RM(0, "10")).toBe(0);
    expect(epley1RM(100, "")).toBe(0);
  });
});

describe("cmpStrength — score mode", () => {
  it("compound ranks by e1RM (a lighter, higher-e1RM set wins)", () => {
    // 14×12 (e1RM 19.6) beats 10×16 (e1RM 15.3) on the strength axis…
    expect(cmpStrength(set(19.6, 168), set(15.3, 160), "compound")).toBeGreaterThan(0);
  });

  it("isolation ranks by tonnage (the SAME pair flips)", () => {
    // …but 14×12 (tonnage 168) still beats 10×16 (160) on tonnage — and a real
    // higher-tonnage set would win even at a lower e1RM.
    expect(cmpStrength(set(15.3, 200), set(19.6, 168), "isolation")).toBeGreaterThan(0);
  });

  it("isolation tie-break: equal tonnage → heavier load wins", () => {
    // 20×10 vs 10×20, both tonnage 200: mechanical tension breaks the tie.
    const heavy = set(0, 200, 20, 10);
    const light = set(0, 200, 10, 20);
    expect(cmpStrength(heavy, light, "isolation")).toBeGreaterThan(0);
  });
});

describe("classifyPR — score mode", () => {
  const prev = { e1rm: 19.6, weightKg: 14, tonnage: 168 };

  it("isolation: a new tonnage ceiling is a single Hypertrophy PR", () => {
    expect(classifyPR(set(15, 180, 12, 15), prev, set(19.6, 168, 14, 12), "isolation")).toBe(
      "hypertrophy",
    );
  });

  it("isolation: a rep-target change that holds tonnage is NOT a PR (no false gold)", () => {
    // 10×16 = tonnage 160 < prev 168 → not a hypertrophy PR (and never a strength/perf one).
    expect(classifyPR(set(15.3, 160, 10, 16), prev, set(19.6, 168, 14, 12), "isolation")).toBeNull();
  });

  it("compound is unchanged: new e1RM ceiling = strength, heavier-at-flat-e1RM = performance", () => {
    expect(classifyPR(set(20, 999, 15, 10), prev, set(19.6, 168, 14, 12), "compound")).toBe(
      "strength",
    );
    // 77×7 ≈ 95.0 e1RM ties 75×8's ceiling but is the heaviest weight → performance.
    const flatPrev = { e1rm: 95, weightKg: 75, tonnage: 600 };
    expect(
      classifyPR(set(94.97, 539, 77, 7), flatPrev, set(95, 600, 75, 8), "compound"),
    ).toBe("performance");
  });
});
