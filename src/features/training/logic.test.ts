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

// ─── computeWeeklyVolume ─────────────────────────────────────────────────────

import { computeWeeklyVolume } from "./logic";
import type { TrainingLog } from "./api";

// Minimal log builder — computeWeeklyVolume only reads log_date + raw (via
// toLogEntry); everything else is carried along untouched.
const vlog = (date: string, raw: string): TrainingLog =>
  ({ log_date: date, raw }) as TrainingLog;

// setCount 1 keeps the arithmetic readable: "100*10" → 100kg × 10 reps = 1000.
const pullRoster = [
  { slug: "row", split: "pull", setCount: 1 },
  { slug: "curl", split: "pull", setCount: 1 },
];

// today = Fri 2026-07-10 → this week starts Mon 2026-07-06, last week 06-29.
const TODAY = "2026-07-10";

describe("computeWeeklyVolume — split-completion carry-forward", () => {
  it("completes the roster from each lift's latest prior record", () => {
    const logs = {
      // Last week (Tue 6/30): both lifts logged → 1000 + 500.
      // This week (Wed 7/8): only row re-logged → curl carries forward its 6/30 set.
      row: [vlog("2026-07-08", "110*10"), vlog("2026-06-30", "100*10")],
      curl: [vlog("2026-06-30", "50*10")],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.lastWeekKg).toBe(1500);
    expect(stat.thisWeekKg).toBe(1100 + 500); // logged row + carried curl
    expect(stat.deltaPct).toBeCloseTo(((1600 - 1500) / 1500) * 100, 5);
    expect(stat.thisWeekSessions).toEqual([
      { date: "2026-07-08", split: "pull", volumeKg: 1600 },
    ]);
  });

  it("carry-forward reads the record as of the session date, not a later one", () => {
    const logs = {
      row: [vlog("2026-07-08", "110*10"), vlog("2026-06-28", "100*10")],
      // curl trained alone last Wed → that session pulls row's 6/28 numbers,
      // NOT the 7/8 improvement that hadn't happened yet.
      curl: [vlog("2026-07-01", "50*10")],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.lastWeekSessions).toEqual([
      { date: "2026-07-01", split: "pull", volumeKg: 500 + 1000 },
    ]);
  });

  it("counts each trained date of a split as its own session", () => {
    const logs = {
      row: [vlog("2026-07-08", "100*10"), vlog("2026-07-06", "100*10")],
      curl: [vlog("2026-07-06", "50*10")],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.thisWeekSessions.map((s) => s.date)).toEqual([
      "2026-07-08",
      "2026-07-06",
    ]);
    // 7/6: 1000+500; 7/8: 1000 + carried 500.
    expect(stat.thisWeekKg).toBe(3000);
  });

  it("pace-matches the delta: week-to-date vs last week through the same weekday", () => {
    // today = Mon 2026-07-13 (week just started). Last week trained Mon 7/6 AND
    // Wed 7/8; the delta must judge this Monday against last Monday only, not
    // against last week's two-session total (which would read as a big drop).
    const logs = {
      row: [vlog("2026-07-13", "100*10"), vlog("2026-07-08", "90*10"), vlog("2026-07-06", "80*10")],
      curl: [vlog("2026-07-13", "50*10"), vlog("2026-07-06", "40*10")],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, "2026-07-13");
    expect(stat.thisWeekKg).toBe(1500); // 1000 + 500
    expect(stat.lastWeekKg).toBe(2500); // full week: 1200 (Mon) + 1300 (Wed)
    expect(stat.lastWeekKgToDate).toBe(1200); // through Mon only
    expect(stat.lastWeekCutoff).toBe("2026-07-06");
    expect(stat.deltaPct).toBeCloseTo(((1500 - 1200) / 1200) * 100, 5); // +25%, not −40%
  });

  it("reports no delta without a prior-week baseline", () => {
    const logs = { row: [vlog("2026-07-08", "100*10")], curl: [] };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.deltaPct).toBeNull();
    expect(stat.lastWeekSessions).toEqual([]);
  });
});
