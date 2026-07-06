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
    expect(bench.needsAttention).toBe(true);
    expect(s.attention).toBe(1);
  });
});
