import { describe, it, expect } from "vitest";
import { epley1RM } from "./logic";

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
