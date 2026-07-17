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

import { computeWeeklyVolume, computeMuscleWeeklyVolume, computeWeeklyVolumeTrend } from "./logic";
import type { TrainingLog } from "./api";

// Minimal log builder — computeWeeklyVolume only reads log_date + raw (via
// toLogEntry); everything else is carried along untouched.
const vlog = (date: string, raw: string): TrainingLog =>
  ({ log_date: date, raw }) as TrainingLog;

// setCount 1 keeps the arithmetic readable: "100*10" → 100kg × 10 reps = 1000.
const pullRoster = [
  { slug: "row", split: "pull", setCount: 1, assistedMode: false },
  { slug: "curl", split: "pull", setCount: 1, assistedMode: false },
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
    // Trailing window clips to history: last week is the only completed week,
    // so the average IS last week; no prior window → no delta.
    expect(stat.avgWeekKg).toBe(1500);
    expect(stat.weeksCounted).toBe(1);
    expect(stat.deltaPct).toBeNull();
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

  it("averages the trailing completed weeks — the in-progress week never dilutes", () => {
    // Two completed weeks (Mon 6/29: 1200; Mon 6/22: 1000) plus a big session
    // this week (7/8) that must stay out of the average.
    const logs = {
      row: [
        vlog("2026-07-08", "200*10"),
        vlog("2026-06-29", "120*10"),
        vlog("2026-06-22", "100*10"),
      ],
      curl: [],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.weeksCounted).toBe(2);
    expect(stat.avgWeekKg).toBe(1100); // (1200 + 1000) / 2
    expect(stat.thisWeekKg).toBe(2000); // disclosure detail only
    expect(stat.deltaPct).toBeNull(); // both weeks fit the trailing window
  });

  it("沒記就是維持: an unlogged week inherits the split's last logged week", () => {
    // Weeks 6/15 (1000) and 6/29 (1200) logged; week 6/22 has no logs at all.
    // Silence = maintained → 6/22 counts as 1000 (the 6/15 shape), so the
    // average reads (1200+1000+1000)/3, not (1200+0+1000)/3.
    const logs = {
      row: [vlog("2026-06-29", "120*10"), vlog("2026-06-15", "100*10")],
      curl: [],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.weeksCounted).toBe(3);
    expect(stat.avgWeekKg).toBeCloseTo(3200 / 3, 5);
    expect(stat.deltaPct).toBeNull();
  });

  it("judges the trailing-window average against the previous window's", () => {
    // Five completed weeks: 6/29 lifts 1200, the rest 1000 each. Trailing
    // window = 6/8..6/29 → avg 1050; previous window clips to [6/1] → 1000.
    const logs = {
      row: [
        vlog("2026-06-29", "120*10"),
        vlog("2026-06-22", "100*10"),
        vlog("2026-06-15", "100*10"),
        vlog("2026-06-08", "100*10"),
        vlog("2026-06-01", "100*10"),
      ],
      curl: [],
    };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.weeksCounted).toBe(4);
    expect(stat.avgWeekKg).toBe(1050);
    expect(stat.deltaPct).toBeCloseTo(((1050 - 1000) / 1000) * 100, 5);
  });

  it("falls back to the in-progress week when it's the user's first", () => {
    const logs = { row: [vlog("2026-07-08", "100*10")], curl: [] };
    const stat = computeWeeklyVolume(logs, pullRoster, TODAY);
    expect(stat.weeksCounted).toBe(0);
    expect(stat.avgWeekKg).toBe(1000); // = thisWeekKg
    expect(stat.deltaPct).toBeNull();
    expect(stat.lastWeekSessions).toEqual([]);
  });
});

describe("computeWeeklyVolumeTrend — maintained weekly bars", () => {
  it("carries unlogged weeks at the last logged shape, flagged as not logged", () => {
    const logs = {
      row: [vlog("2026-06-29", "120*10"), vlog("2026-06-15", "100*10")],
      curl: [],
    };
    const trend = computeWeeklyVolumeTrend(logs, pullRoster, TODAY);
    // Clipped to history: series starts at the first logged week.
    expect(trend.map((p) => p.weekStart)).toEqual(["2026-06-15", "2026-06-22", "2026-06-29"]);
    expect(trend.map((p) => p.kg)).toEqual([1000, 1000, 1200]); // 6/22 maintained
    expect(trend.map((p) => p.logged)).toEqual([true, false, true]);
  });

  it("excludes the in-progress week", () => {
    const logs = { row: [vlog("2026-07-08", "100*10"), vlog("2026-06-29", "90*10")], curl: [] };
    const trend = computeWeeklyVolumeTrend(logs, pullRoster, TODAY); // week of 7/6 in progress
    expect(trend.map((p) => p.weekStart)).toEqual(["2026-06-29"]);
  });
});

describe("computeMuscleWeeklyVolume — same rows, muscle buckets, avg sets/week", () => {
  const muscleOf = (ex: { slug: string }) => (ex.slug === "row" ? "back" : "biceps");

  it("credits the configured set count per trained session, carry-forward included", () => {
    const roster = [
      { slug: "row", split: "pull", setCount: 3, assistedMode: false },
      { slug: "curl", split: "pull", setCount: 2, assistedMode: false },
    ];
    const logs = {
      // Trailing window clips to the one completed week (Mon 6/29). Tue 6/30:
      // only row logged — curl carries forward into that session and still
      // counts its configured 2 sets. This week's 7/8 session stays out.
      row: [vlog("2026-07-08", "110*10"), vlog("2026-06-30", "100*10")],
      curl: [vlog("2026-06-30", "50*10")],
    };
    const muscle = computeMuscleWeeklyVolume(logs, roster, TODAY, muscleOf);
    expect(muscle.map((m) => m.group)).toEqual(["back", "biceps"]); // sorted by avg sets
    const back = muscle.find((m) => m.group === "back")!;
    expect(back.avgWeekSets).toBe(3); // 3 sets over 1 counted week
    expect(back.slugs).toEqual(["row"]);
    const biceps = muscle.find((m) => m.group === "biceps")!;
    expect(biceps.avgWeekSets).toBe(2); // carried curl still credits biceps
    expect(biceps.slugs).toEqual(["curl"]);
  });

  it("averages over the trailing window and judges it against the previous one", () => {
    // Five completed weeks of one back session each, plus a second session in
    // the 6/29 week → trailing window (6/8..6/29) totals 5 sets over 4 weeks;
    // previous window clips to [6/1] → avg 1.
    const logs = {
      row: [
        vlog("2026-07-01", "100*10"),
        vlog("2026-06-29", "100*10"),
        vlog("2026-06-22", "100*10"),
        vlog("2026-06-15", "90*10"),
        vlog("2026-06-08", "90*10"),
        vlog("2026-06-01", "90*10"),
      ],
      curl: [],
    };
    const back = computeMuscleWeeklyVolume(logs, pullRoster, TODAY, muscleOf).find(
      (m) => m.group === "back",
    )!;
    expect(back.avgWeekSets).toBe(1.25); // 5 sets / 4 weeks
    expect(back.prevAvgWeekSets).toBe(1);
    expect(back.deltaSets).toBe(0.25);
  });

  it("counts sets for zero-tonnage logs the kg view can't see, omits absent groups", () => {
    // Unparseable raw → volumeKg 0, but the session happened → sets count.
    // First week in progress → falls back to averaging the current week.
    const logs = { row: [vlog("2026-07-08", "felt strong")], curl: [] };
    const muscle = computeMuscleWeeklyVolume(logs, pullRoster, TODAY, muscleOf);
    expect(muscle.map((m) => m.group)).toEqual(["back"]); // curl never logged → no biceps
    expect(muscle[0].avgWeekSets).toBe(1);
    expect(muscle[0].deltaSets).toBeNull(); // no prior window → no baseline
  });

  it("沒記就是維持: a split with no logs in a week inherits its last logged week", () => {
    // Curl lives on its own split, last logged 6/1 (previous window). The
    // trailing window has no arms logs — but silence means maintained, so
    // biceps holds at 1 set/wk with a flat delta, never dropping to 0.
    const roster = [
      { slug: "row", split: "pull", setCount: 1, assistedMode: false },
      { slug: "curl", split: "arms", setCount: 1, assistedMode: false },
    ];
    const logs = {
      row: [
        vlog("2026-06-29", "100*10"),
        vlog("2026-06-22", "100*10"),
        vlog("2026-06-15", "90*10"),
        vlog("2026-06-08", "90*10"),
      ],
      curl: [vlog("2026-06-01", "50*10")],
    };
    const biceps = computeMuscleWeeklyVolume(logs, roster, TODAY, muscleOf).find(
      (m) => m.group === "biceps",
    )!;
    expect(biceps.avgWeekSets).toBe(1);
    expect(biceps.prevAvgWeekSets).toBe(1);
    expect(biceps.deltaSets).toBe(0);
  });
});

// ─── scoreWeight — assisted lifts score on % of bodyweight ───────────────────

import { scoreWeight, toLogEntry, computeHistDelta } from "./logic";
import { parse } from "./parser";

describe("scoreWeight — assisted %BW axis", () => {
  it("normal logs score on absolute kg (identical to score)", () => {
    expect(scoreWeight(parse("100*10")!, false)).toBe(100);
  });

  it("assisted logs score on % of bodyweight lifted", () => {
    // bw 100, assist 20 → lifting 80% of bodyweight.
    expect(scoreWeight(parse("100-(20) *10")!, true)).toBeCloseTo(80, 5);
  });

  it("a non-assisted exercise ignores stray assist syntax (scores kg, never %BW)", () => {
    // assisted_mode off → the axis is kg even if a raw somehow parses as assisted,
    // so a %BW score can never mix into a kg trend. score("100-(20)") = 80 kg.
    expect(scoreWeight(parse("100-(20) *10")!, false)).toBe(80);
  });

  it("an assisted exercise drops a log with no assisted form (NaN → excluded)", () => {
    // No bodyweight to convert to %BW → NaN, so toLogEntry drops it rather than
    // placing raw kg on the %BW axis.
    expect(Number.isNaN(scoreWeight(parse("100*10")!, true))).toBe(true);
    expect(toLogEntry({ log_date: "2026-07-01", raw: "100*10" } as TrainingLog, 3, true)).toBeNull();
  });

  it("a lighter body at the same relative pull scores flat — no phantom decline", () => {
    // The real Assisted Pull-up artifact: on a cut the effective kg falls with
    // the body, so absolute e1RM read 10/10/10 → 10/10/10 as a drop. Same
    // fraction of a lighter body must score the same.
    const heavy = toLogEntry({ log_date: "2026-06-01", raw: "100-(20) *10/10/10" } as TrainingLog, 3, true)!;
    const light = toLogEntry({ log_date: "2026-07-01", raw: "90-(18) *10/10/10" } as TrainingLog, 3, true)!;
    expect(light.e1rm).toBeCloseTo(heavy.e1rm, 5);
    // Assisted scores the plain %BW lifted — NO Epley. 80% BW stays 80, never a
    // 1RM projection (which would inflate 10 reps to ~106% and misread as load).
    expect(heavy.e1rm).toBeCloseTo(80, 5);
    expect(light.tonnage).toBeCloseTo(heavy.tonnage, 5);
    // Display/milestone kg still tracks the real effective load.
    expect(heavy.weightKg).toBe(80);
    expect(light.weightKg).toBe(72);
  });

  it("histDelta direction follows relative strength even when effective kg fell", () => {
    // prev: 75% of bw (100−25); curr: 80% of a lighter bw (90−18). Effective kg
    // fell 75 → 72, but the pull got relatively STRONGER → gain, and the delta
    // reads in %BW (not kg), so a bodyweight-driven kg drop can't show as a loss.
    const curr = { log_date: "2026-07-01", raw: "90-(18) *10" } as TrainingLog;
    const prev = { log_date: "2026-06-01", raw: "100-(25) *10" } as TrainingLog;
    const d = computeHistDelta(curr, prev, 3, "compound", true)!;
    expect(d.direction).toBe("gain");
    expect(d.text).toContain("%"); // 80.0 − 75.0 = ▲ 5%, never "kg"
    expect(d.text).not.toContain("BW"); // row already carries the "%BW" label
    expect(d.text).not.toContain("kg");
  });

  it("histDelta direction follows %BW (no Epley) when reps swing on an assisted pair", () => {
    // prev: 70%BW × 12; curr: 75%BW × 3. Under Epley the rep drop would win
    // (98 vs 82.5 → loss) and the arrow would contradict the "+5%" magnitude
    // shown beside it. Assisted compares plain %BW: 75 > 70 → gain.
    const curr = { log_date: "2026-07-01", raw: "100-(25) *3" } as TrainingLog;
    const prev = { log_date: "2026-06-01", raw: "100-(30) *12" } as TrainingLog;
    const d = computeHistDelta(curr, prev, 3, "compound", true)!;
    expect(d.direction).toBe("gain");
    expect(d.text).toContain("%");
    expect(d.text).not.toContain("kg");
  });

  it("histDelta uses kg for a normal (non-assisted) pair", () => {
    const curr = { log_date: "2026-07-01", raw: "102*10" } as TrainingLog;
    const prev = { log_date: "2026-06-01", raw: "100*10" } as TrainingLog;
    const d = computeHistDelta(curr, prev, 3, "compound", false)!;
    expect(d.text).toContain("kg");
    expect(d.text).not.toContain("%BW");
  });
});
