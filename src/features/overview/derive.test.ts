import { describe, it, expect } from "vitest";
import {
  activeTargetPosition, weekActiveTotal, weekBanked, bankedTone, weekStripCells,
  phasePlanNote, cutStageLabel, bulkStageLabel, nextCutStageLabel, weightLineTone, accelArrowTone,
  buildSparkGeometry, SPARK_W, SPARK_PAD,
} from "./derive";
import type { BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import type { GoalStatusEvaluation } from "./goal";

// Minimal builders — only the fields each function reads.
const metric = (metric_date: string, active_energy_kcal: number | null) =>
  ({ metric_date, active_energy_kcal }) as unknown as BodyMetric;

const view = (over: Partial<ActiveTargetView> & { today?: Partial<ActiveTargetView["today"]> }): ActiveTargetView =>
  ({
    activeTargetPerDay: 500,
    mondayISO: "2026-07-13",
    weekday: 2,
    accruedThroughYesterday: 500,
    today: { target: 500, accrued: 250, synced: true, lastSyncDate: "2026-07-14", ...(over.today ?? {}) },
    ...over,
  }) as unknown as ActiveTargetView;

const goalStatus = (reached: boolean, targetBodyFatPct: number | null): GoalStatusEvaluation =>
  ({ reached, targetBodyFatPct, bodyFat14dAvg: null }) as unknown as GoalStatusEvaluation;

describe("activeTargetPosition", () => {
  it("within ±30 kcal reads on-pace (anti-flicker deadband)", () => {
    expect(activeTargetPosition(500, 500)).toBe("on");
    expect(activeTargetPosition(530, 500)).toBe("on"); // exactly at the edge
    expect(activeTargetPosition(470, 500)).toBe("on");
  });
  it("a raised target reads behind", () => {
    expect(activeTargetPosition(531, 500)).toBe("behind");
  });
  it("an eased target reads ahead", () => {
    expect(activeTargetPosition(469, 500)).toBe("ahead");
  });
});

describe("weekActiveTotal", () => {
  const metrics = [
    metric("2026-07-12", 999), // Sunday before — excluded
    metric("2026-07-13", 400), // Mon
    metric("2026-07-15", 600), // Wed
    metric("2026-07-19", 300), // Sun (last day in-week)
    metric("2026-07-20", 999), // next Mon — excluded
    metric("2026-07-16", null), // null reading — skipped
  ];
  it("sums only in-week, non-null readings (Mon inclusive, next Mon exclusive)", () => {
    expect(weekActiveTotal(metrics, "2026-07-13")).toBe(1300);
  });
});

describe("weekBanked", () => {
  it("current week = accrued-through-yesterday minus flat pace for elapsed days", () => {
    // weekday 3 (Wed) → 2 elapsed days; 900 accrued vs 2×500 flat = −100.
    const v = view({ weekday: 3, accruedThroughYesterday: 900 });
    expect(weekBanked(v, true, 0)).toBe(-100);
  });
  it("past week = full-week total minus the 7-day goal, rounded", () => {
    const v = view({});
    expect(weekBanked(v, false, 3700)).toBe(200); // 3700 − 3500
  });
});

describe("bankedTone", () => {
  it("splits good / warn / neutral on ±30", () => {
    expect(bankedTone(31)).toBe("good");
    expect(bankedTone(30)).toBe("neutral");
    expect(bankedTone(-30)).toBe("neutral");
    expect(bankedTone(-31)).toBe("warn");
  });
});

describe("weekStripCells", () => {
  const v = view({ today: { target: 500, accrued: 250, synced: true, lastSyncDate: "2026-07-14" } });
  const metrics = [metric("2026-07-13", 500)]; // Mon fully met
  const cells = weekStripCells(v, metrics, "2026-07-13", "2026-07-14");

  it("produces seven cells", () => {
    expect(cells).toHaveLength(7);
  });
  it("classifies past / today / future by date", () => {
    expect(cells.map((c) => c.kind)).toEqual([
      "past", "today", "future", "future", "future", "future", "future",
    ]);
  });
  it("a met past day fills to 1 and reads --good (not the ring's gold)", () => {
    expect(cells[0].fill).toBe(1);
    expect(cells[0].ringColor).toBe("var(--good)");
  });
  it("today follows the floating ring's ratio, clamped to 1", () => {
    expect(cells[1].fill).toBe(0.5); // 250 / 500
  });
  it("future days are empty with no colour", () => {
    expect(cells[2]).toMatchObject({ fill: 0, ringColor: undefined });
  });
});

describe("phasePlanNote", () => {
  const bulkGoal = (reached: boolean, ceiling = 21) =>
    ({ reached, bodyFat14dAvg: 19, bfCeilingPct: ceiling });

  it("at maintenance → hold, no tone", () => {
    expect(phasePlanNote("maintenance", goalStatus(false, 12), null, 0, 4, 2))
      .toEqual({ text: "Hold for 4–6 weeks, then start the lean bulk", tone: "" });
  });
  it("post-bulk maintenance names both honest exits (resume or next cut)", () => {
    expect(phasePlanNote("maintenance", goalStatus(false, 12), null, 0, 4, 2, true))
      .toEqual({ text: "Hold for a few weeks, then resume the bulk or start the next cut", tone: "" });
  });
  it("goal reached outranks the signal count → start maintenance (go)", () => {
    const note = phasePlanNote("cut", goalStatus(true, 12), null, 4, 4, 2);
    expect(note.tone).toBe(" is-go");
    expect(note.text).toContain("12% goal");
  });
  it("enough signals stacked → consider", () => {
    const note = phasePlanNote("cut", goalStatus(false, 12), null, 3, 4, 2);
    expect(note.tone).toBe(" is-consider");
    expect(note.text).toBe("3 of 4 signals are on — consider switching to maintenance");
  });
  it("below the consider threshold → the watch-for prompt", () => {
    expect(phasePlanNote("cut", goalStatus(false, 12), null, 1, 4, 2))
      .toEqual({ text: "Switch early if these stack up:", tone: "" });
  });
  it("bulk at the ceiling → start the cut (go)", () => {
    const note = phasePlanNote("bulk", goalStatus(false, 12), bulkGoal(true), 4, 4, 2);
    expect(note.tone).toBe(" is-go");
    expect(note.text).toContain("21% ceiling — start the cut");
  });
  it("bulk with stacked signals → consider a maintenance break", () => {
    const note = phasePlanNote("bulk", goalStatus(false, 12), bulkGoal(false), 2, 4, 2);
    expect(note.tone).toBe(" is-consider");
    expect(note.text).toBe("2 of 4 signals are on — consider a maintenance break");
  });
  it("bulk below the threshold → the building prompt", () => {
    expect(phasePlanNote("bulk", goalStatus(false, 12), bulkGoal(false), 0, 4, 2))
      .toEqual({ text: "Building — switch early if these stack up:", tone: "" });
  });
});

describe("cutStageLabel", () => {
  it("names the endpoint when a target is set", () => {
    expect(cutStageLabel(12)).toBe("Cut → 12% BF");
  });
  it("falls back to a bare Cut", () => {
    expect(cutStageLabel(null)).toBe("Cut");
  });
  it("next-cut stage reuses the body-fat target, bare until configured", () => {
    expect(nextCutStageLabel(12)).toBe("Next cut → 12% BF");
    expect(nextCutStageLabel(null)).toBe("Next cut");
  });
  it("bulk stage names its ceiling, bare until configured", () => {
    expect(bulkStageLabel(21)).toBe("Lean Bulk → 21% cap");
    expect(bulkStageLabel(null)).toBe("Lean Bulk");
  });
});

describe("weightLineTone", () => {
  it("mirrors under up-good (a bulk): up = good, down = bad", () => {
    expect(weightLineTone(0.3, "up-good")).toBe("good");
    expect(weightLineTone(-0.3, "up-good")).toBe("bad");
    expect(weightLineTone(0, "up-good")).toBe("flat");
  });
  it("down = good, up = bad, flat/absent = flat", () => {
    expect(weightLineTone(-0.3)).toBe("good");
    expect(weightLineTone(0.3)).toBe("bad");
    expect(weightLineTone(0)).toBe("flat");
    expect(weightLineTone(null)).toBe("flat");
  });
});

describe("accelArrowTone", () => {
  it("an out-of-band rate drift dominates", () => {
    expect(accelArrowTone("bad", "faster")).toBe("bad");
    expect(accelArrowTone("warn", "faster")).toBe("warn");
  });
  it("in-band: a slowdown warns, otherwise good", () => {
    expect(accelArrowTone("good", "slowing")).toBe("warn");
    expect(accelArrowTone("good", "faster")).toBe("good");
    expect(accelArrowTone(null, "slowing")).toBe("warn");
    expect(accelArrowTone("gold", "faster")).toBe("good");
    expect(accelArrowTone(null, null)).toBe("good");
  });
});

describe("buildSparkGeometry", () => {
  const points = [
    { date: "2026-07-01", value: 92 },
    { date: "2026-07-08", value: 91 },
    { date: "2026-07-15", value: 90 },
  ];

  it("maps points across the padded width, latest at the right edge", () => {
    const g = buildSparkGeometry(points, null);
    expect(g.pts).toBe("4.0,4.0 50.0,48.0 96.0,92.0");
    expect(g.latest).toEqual({ x: SPARK_W - SPARK_PAD, y: 92 });
  });
  it("closes the area polygon along the baseline", () => {
    const g = buildSparkGeometry(points, null);
    expect(g.area.endsWith("96.0,96 4.0,96")).toBe(true);
  });
  it("no corridor without an active target band", () => {
    expect(buildSparkGeometry(points, null).corridor).toBeNull();
    expect(buildSparkGeometry(points, { min: 0.5, max: 0.5 }).corridor).toBeNull(); // collapsed band
  });
  it("draws a corridor wedge when a real band exists", () => {
    const g = buildSparkGeometry(points, { min: 0.25, max: 0.75 });
    expect(g.corridor).not.toBeNull();
    for (const v of Object.values(g.corridor!)) expect(Number.isFinite(v)).toBe(true);
  });
});
