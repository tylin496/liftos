import { describe, it, expect } from "vitest";
import { computeStrengthSummary, buildTrainingEvaluation } from "./strength";

// raw format is "<weight>*<reps>" — see training/parser.
const log = (log_date: string, raw: string) => ({ log_date, raw });

describe("computeStrengthSummary — two-axis stall clock", () => {
  it("a heavier top set that's Epley-flat (Performance PR) resets stalledWeeks", () => {
    // 75×8 sets the e1RM ceiling (95.0). 77×7 is heavier but rates ≈ the same
    // e1RM (94.97 → rounds to 95.0), so the e1RM-only clock would ignore it and
    // keep counting weeks stalled — but it's a genuine Performance PR (heaviest
    // weight ever), so the two-axis clock resets to that session.
    const summary = computeStrengthSummary({
      bench: [
        log("2026-01-01", "75*8"),
        log("2026-01-08", "70*8"),
        log("2026-01-15", "72*8"),
        log("2026-02-19", "77*7"),
      ],
    });
    const bench = summary.exercises.find((e) => e.slug === "bench")!;
    expect(bench.stalledWeeks).toBe(0);
    expect(bench.lastPRDate).toBe("2026-02-19"); // the weight-axis Performance PR
  });

  it("a genuine plateau (no PR on either axis) still accrues stalledWeeks", () => {
    const summary = computeStrengthSummary({
      bench: [
        log("2026-01-01", "80*8"), // ceiling + heaviest
        log("2026-01-08", "70*8"),
        log("2026-01-15", "72*8"),
        log("2026-02-19", "75*7"), // below both axes → clock keeps running
      ],
    });
    const bench = summary.exercises.find((e) => e.slug === "bench")!;
    expect(bench.stalledWeeks).toBeGreaterThanOrEqual(6);
  });

  it("the two-axis reset flows through to the Decision Engine's training verdict", () => {
    // The plateau lift is watch + stalled → contributes to a 'declining' verdict.
    const plateau = computeStrengthSummary({
      a: [log("2026-01-01", "80*8"), log("2026-01-08", "70*8"), log("2026-01-15", "72*8"), log("2026-02-19", "60*8")],
      b: [log("2026-01-01", "80*8"), log("2026-01-08", "70*8"), log("2026-01-15", "72*8"), log("2026-02-19", "60*8")],
    });
    expect(buildTrainingEvaluation(plateau).trend).toBe("declining");
  });
});

describe("computeStrengthSummary — needs-attention gating (recent-PR grace)", () => {
  it("a watch lift that PR'd within the grace window is NOT flagged (the Assisted Pullup case)", () => {
    const s = computeStrengthSummary({
      bench: [
        log("2026-06-01", "70*8"),
        log("2026-06-10", "75*8"),
        log("2026-06-15", "76*8"), // fresh PR on both axes
        log("2026-07-04", "65*8"), // one lighter session → ~85% of PR
      ],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.status).toBe("watch"); // latest session is below 94% of PR
    expect(bench.stalledWeeks).toBeLessThan(3); // but it PR'd ~2 weeks ago
    expect(bench.needsAttention).toBe(false); // → stays out of the red
    expect(s.attention).toBe(0);
  });

  it("a watch lift stuck for weeks IS flagged", () => {
    const s = computeStrengthSummary({
      bench: [log("2026-01-01", "80*8"), log("2026-01-08", "70*8"), log("2026-01-15", "72*8"), log("2026-02-19", "60*8")],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.status).toBe("watch");
    expect(bench.recovering).toBe(false); // last 3 sessions trend DOWN → not climbing
    expect(bench.needsAttention).toBe(true);
    expect(s.attention).toBe(1);
  });

  it("a watch lift climbing back over its last sessions is NOT flagged (recovery)", () => {
    // 80×8 is the all-time PR (both axes). It then drops and climbs back over the
    // next three logged sessions — 60→65→70×8 — a two-step climb still well below
    // PR (~88% of the 80×8 e1RM). Distance-from-PR + stall clock (6wk) would flag
    // it, but the recovery override pulls it off the red list: it's self-correcting.
    const s = computeStrengthSummary({
      squat: [
        log("2026-01-01", "80*8"), // PR on both axes → stall clock starts here
        log("2026-01-20", "60*8"),
        log("2026-02-01", "65*8"),
        log("2026-02-15", "70*8"), // latest: still ~88% of PR, but climbing
      ],
    });
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.status).toBe("watch"); // latest is below 94% of PR
    expect(squat.stalledWeeks).toBeGreaterThanOrEqual(3); // and stalled long enough to flag
    expect(squat.recovering).toBe(true); // …but the last 3 sessions are climbing
    expect(squat.needsAttention).toBe(false); // → rescued from the red list
    expect(s.attention).toBe(0);
  });

  it("a single up-tick after a slide does NOT count as recovery (needs two steps)", () => {
    // 90→75→85×8: the latest rebounds but the step before it fell — one bounce,
    // not a climb. Stays flagged so noise can't clear a genuinely stuck lift.
    const s = computeStrengthSummary({
      row: [
        log("2026-01-01", "100*8"), // PR
        log("2026-01-20", "90*8"),
        log("2026-02-01", "75*8"),
        log("2026-02-15", "85*8"), // up vs prior, but the middle step dropped
      ],
    });
    const row = s.exercises.find((e) => e.slug === "row")!;
    expect(row.status).toBe("watch");
    expect(row.recovering).toBe(false);
    expect(row.needsAttention).toBe(true);
  });
});

describe("computeStrengthSummary — milestoneKg (reward-row 🎯 chip)", () => {
  // The last session crosses 100 kg (heaviest ever, new rung) AND raises the
  // e1RM ceiling — the classic Strength PR + milestone the gold chip is for.
  const crossing = {
    squat: [
      log("2026-01-01", "90*5"),
      log("2026-01-08", "92*5"),
      log("2026-01-15", "95*5"),
      log("2026-02-01", "100*5"), // heaviest ever → crosses the 100 rung
    ],
  };

  it("captures the rung at the last PR when the slug is flagged compound", () => {
    const s = computeStrengthSummary(crossing, new Set(["squat"]));
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.lastPRKind).toBe("strength");
    expect(squat.milestoneKg).toBe(100);
  });

  it("stays undefined for a non-compound lift (rung spam guard)", () => {
    const s = computeStrengthSummary(crossing, new Set()); // squat not flagged
    expect(s.exercises.find((e) => e.slug === "squat")!.milestoneKg).toBeUndefined();
  });

  it("stays undefined when no compound set is supplied (engine / export callers)", () => {
    const s = computeStrengthSummary(crossing);
    expect(s.exercises.find((e) => e.slug === "squat")!.milestoneKg).toBeUndefined();
  });

  it("stays undefined when the PR set no new rung", () => {
    // Heaviest climbs 90→95 but never clears the next rung (100), so no milestone.
    const s = computeStrengthSummary(
      { squat: [log("2026-01-01", "90*5"), log("2026-01-08", "70*5"), log("2026-01-15", "72*5"), log("2026-02-01", "95*5")] },
      new Set(["squat"]),
    );
    expect(s.exercises.find((e) => e.slug === "squat")!.milestoneKg).toBeUndefined();
  });
});
