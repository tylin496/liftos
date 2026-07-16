import { describe, it, expect } from "vitest";
import {
  evaluatePhaseTriggers,
  countOverBudgetDays,
  type PhaseTriggerInputs,
  type PhaseTriggerEntry,
} from "./phaseTriggers";
import type { BodyMetric } from "@features/health/api";
import type { StrengthSummary, StrengthExercise } from "./strength";

const MS = 86400000;

/** ISO date `n` days before `anchor` (default a fixed past date — every trigger
 *  except T3's stale gate is now-free, so fixtures can live in the past). */
const daysAgo = (n: number, anchor = "2026-03-01"): string =>
  new Date(new Date(anchor + "T12:00:00").getTime() - n * MS).toISOString().slice(0, 10);

/** Local calendar today — T3's offset-0 stale gate is wall-clock, so recovery
 *  fixtures must end on real today to read as fresh. */
const realToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function weightMetrics(values: (number | null)[], anchor?: string): BodyMetric[] {
  const n = values.length;
  return values.map(
    (v, i) => ({ metric_date: daysAgo(n - 1 - i, anchor), weight_kg: v }) as unknown as BodyMetric,
  );
}

const GOOD = { sleep_seconds: 25200, hrv_sdnn_ms: 60, resting_heart_rate: 55 };
const BAD = { sleep_seconds: 19800, hrv_sdnn_ms: 45, resting_heart_rate: 62 };

/** `days` recovery rows ending at `anchor`; the last `badTail` of them carry the
 *  depressed markers. */
function recoveryMetrics(days: number, badTail: number, anchor: string): BodyMetric[] {
  return Array.from({ length: days }, (_, i) => {
    const back = days - 1 - i;
    return {
      metric_date: daysAgo(back, anchor),
      ...(back < badTail ? BAD : GOOD),
    } as unknown as BodyMetric;
  });
}

function lift(over: {
  slug: string;
  direction?: "recovering" | "stable" | "declining";
  confidence?: number;
}): StrengthExercise {
  return {
    slug: over.slug,
    name: over.slug,
    trajectory: {
      direction: over.direction ?? "stable",
      velocity: over.direction === "declining" ? -0.03 : 0,
      confidence: over.confidence ?? 0.9,
    },
  } as unknown as StrengthExercise;
}

const summary = (exercises: StrengthExercise[]): StrengthSummary =>
  ({ exercises }) as unknown as StrengthSummary;

const entry = (
  date: string,
  calories: number | null,
  tdee = 2705,
  deficit = 500,
): PhaseTriggerEntry => ({ entry_date: date, calories, tdee, deficit_target: deficit });

/** Inputs where every trigger is unknown unless overridden. */
function inputs(over: Partial<PhaseTriggerInputs>): PhaseTriggerInputs {
  return {
    metrics: [],
    strength: null,
    compoundSlugs: new Set(),
    entries: [],
    today: "2026-03-01",
    ...over,
  };
}

const triggerByKey = (r: ReturnType<typeof evaluatePhaseTriggers>, key: string) =>
  r.triggers.find((t) => t.key === key)!;

describe("T1 — weight stall ≥3 weeks", () => {
  it("fires when the 21d trend is flat at all three weekly checkpoints", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics(Array(42).fill(80)) }));
    expect(triggerByKey(r, "weight_stall").state).toBe("firing");
  });

  it("stays ok while weight is still coming down", () => {
    const vals = Array.from({ length: 42 }, (_, i) => 84 - i * 0.07); // ~0.5 kg/wk
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics(vals) }));
    const t = triggerByKey(r, "weight_stall");
    expect(t.state).toBe("ok");
    expect(t.detail).toContain("kg/wk");
  });

  it("a stall only 2 weeks old does not fire (the −14d checkpoint still saw loss)", () => {
    const vals = Array.from({ length: 42 }, (_, i) => (i < 28 ? 84 - i * 0.1 : 84 - 27 * 0.1));
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics(vals) }));
    expect(triggerByKey(r, "weight_stall").state).toBe("ok");
  });

  it("too few weigh-ins → unknown, never firing", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics([80, 80, 80, 80]) }));
    expect(triggerByKey(r, "weight_stall").state).toBe("unknown");
  });

  it("no weigh-ins at all → unknown", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: [] }));
    expect(triggerByKey(r, "weight_stall").state).toBe("unknown");
  });
});

describe("T2 — simultaneous compound decline (confidence-gated)", () => {
  const compounds = new Set(["bench", "rdl", "low-row"]);

  it("fires when two confident compounds decline together, naming them", () => {
    const r = evaluatePhaseTriggers(
      inputs({
        strength: summary([
          lift({ slug: "bench", direction: "declining", confidence: 0.9 }),
          lift({ slug: "rdl", direction: "declining", confidence: 0.75 }),
          lift({ slug: "low-row" }),
        ]),
        compoundSlugs: compounds,
      }),
    );
    const t = triggerByKey(r, "strength_decline");
    expect(t.state).toBe("firing");
    expect(t.detail).toBe("bench, rdl declining");
  });

  it("a low-confidence decline never counts", () => {
    const r = evaluatePhaseTriggers(
      inputs({
        strength: summary([
          lift({ slug: "bench", direction: "declining", confidence: 0.9 }),
          lift({ slug: "rdl", direction: "declining", confidence: 0.4 }),
          lift({ slug: "low-row" }),
        ]),
        compoundSlugs: compounds,
      }),
    );
    const t = triggerByKey(r, "strength_decline");
    expect(t.state).toBe("ok");
    expect(t.detail).toBe("Only bench declining");
  });

  it("declining isolation lifts are ignored", () => {
    const r = evaluatePhaseTriggers(
      inputs({
        strength: summary([
          lift({ slug: "bench" }),
          lift({ slug: "rdl" }),
          lift({ slug: "curl", direction: "declining" }),
          lift({ slug: "fly", direction: "declining" }),
        ]),
        compoundSlugs: compounds,
      }),
    );
    expect(triggerByKey(r, "strength_decline").state).toBe("ok");
  });

  it("fewer than two tracked compounds → unknown", () => {
    const r = evaluatePhaseTriggers(
      inputs({
        strength: summary([lift({ slug: "bench", direction: "declining" })]),
        compoundSlugs: compounds,
      }),
    );
    expect(triggerByKey(r, "strength_decline").state).toBe("unknown");
  });

  it("no strength data → unknown", () => {
    const r = evaluatePhaseTriggers(inputs({ strength: null, compoundSlugs: compounds }));
    expect(triggerByKey(r, "strength_decline").state).toBe("unknown");
  });
});

describe("T3 — recovery persistently worsening", () => {
  it("fires when the markers slid two weeks ago and stayed down", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: recoveryMetrics(45, 14, realToday()) }));
    expect(triggerByKey(r, "recovery_worsening").state).toBe("firing");
  });

  it("a visible rebound (bad stretch, then a good last week) does not fire", () => {
    const metrics = recoveryMetrics(45, 21, realToday()).map((m, i, arr) =>
      i >= arr.length - 7 ? ({ ...m, ...GOOD } as BodyMetric) : m,
    );
    const r = evaluatePhaseTriggers(inputs({ metrics }));
    expect(triggerByKey(r, "recovery_worsening").state).toBe("ok");
  });

  it("steady good recovery stays ok", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: recoveryMetrics(45, 0, realToday()) }));
    const t = triggerByKey(r, "recovery_worsening");
    expect(t.state).toBe("ok");
    expect(t.detail).toBe("Score 3/3 this week");
  });

  it("a stale latest reading → unknown even when the history would fire", () => {
    // Same shape as the firing case, but ending 10 days ago — past the
    // recovery freshness window, so the now-snapshot can't be trusted.
    const r = evaluatePhaseTriggers(inputs({ metrics: recoveryMetrics(45, 14, daysAgo(10, realToday())) }));
    expect(triggerByKey(r, "recovery_worsening").state).toBe("unknown");
  });

  it("no recovery data → unknown", () => {
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics([80, 80, 80]) }));
    expect(triggerByKey(r, "recovery_worsening").state).toBe("unknown");
  });
});

describe("T4 — adherence slipping", () => {
  const today = "2026-03-01";
  // calories vs tdee 2705 / target 500: 2205 on-plan, 2400 over, 2800 counter, 1700 under
  const days = (calories: number[], start = 13): PhaseTriggerEntry[] =>
    calories.map((c, i) => entry(daysAgo(start - i, today), c));

  it("fires at 4 over-budget days in the window", () => {
    const r = evaluatePhaseTriggers(
      inputs({ today, entries: days([2400, 2400, 2400, 2800, 2205, 2205, 2205, 2205, 2205, 2205]) }),
    );
    const t = triggerByKey(r, "adherence_slipping");
    expect(t.state).toBe("firing");
    expect(t.detail).toBe("4 off-plan days in 14");
  });

  it("3 over-budget days stays ok", () => {
    const r = evaluatePhaseTriggers(
      inputs({ today, entries: days([2400, 2400, 2800, 2205, 2205, 2205, 2205, 2205, 2205, 2205]) }),
    );
    expect(triggerByKey(r, "adherence_slipping").state).toBe("ok");
  });

  it("under-budget cut days are not misses", () => {
    const r = evaluatePhaseTriggers(
      inputs({ today, entries: days([1700, 1700, 1700, 1700, 2205, 2205, 2205, 2205, 2205, 2205]) }),
    );
    expect(triggerByKey(r, "adherence_slipping").state).toBe("ok");
  });

  it("fewer than 7 logged days → unknown", () => {
    const r = evaluatePhaseTriggers(
      inputs({ today, entries: days([2400, 2400, 2400, 2800, 2205, 2205]) }),
    );
    expect(triggerByKey(r, "adherence_slipping").state).toBe("unknown");
  });

  it("judges each day against its OWN persisted budget snapshot", () => {
    // 2400 kcal is "over" against tdee 2705/target 500 but "on-plan" against a
    // 2900-TDEE day (deficit 500, ratio 1.0).
    const snapshots = [
      ...Array.from({ length: 4 }, (_, i) => entry(daysAgo(13 - i, today), 2400, 2900, 500)),
      ...Array.from({ length: 6 }, (_, i) => entry(daysAgo(9 - i, today), 2205)),
    ];
    const r = evaluatePhaseTriggers(inputs({ today, entries: snapshots }));
    expect(triggerByKey(r, "adherence_slipping").state).toBe("ok");
  });

  it("countOverBudgetDays ignores days outside the window and unlogged days", () => {
    const entries = [
      entry(daysAgo(20, today), 2800), // outside the 14-day window
      entry(daysAgo(3, today), null), // unlogged
      entry(daysAgo(2, today), 2800),
      entry(daysAgo(1, today), 2205),
    ];
    expect(countOverBudgetDays(entries, today)).toEqual({ over: 1, logged: 2 });
  });
});

describe("firingCount", () => {
  it("counts only firing triggers, never unknown", () => {
    // Stalled weight (firing) + everything else unknown.
    const r = evaluatePhaseTriggers(inputs({ metrics: weightMetrics(Array(42).fill(80)) }));
    expect(r.firingCount).toBe(1);
    expect(r.triggers).toHaveLength(4);
  });
});
