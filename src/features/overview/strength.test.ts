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

  it("a tied-ceiling session with more total reps (reps PR) resets the clock", () => {
    // 75×8/6/4 sets the ceiling e1RM (95.0) at 18 total reps. Later 75×8/8/8 ties
    // that ceiling (still top-8 at 75 kg) AND the heaviest weight (75), so only
    // the reps axis can catch it — 24 > 18 total reps is a Performance PR. Without
    // the reps axis the lift reads stalled ~7 weeks against progress it's making.
    const summary = computeStrengthSummary({
      bench: [
        log("2026-01-01", "75*8/6/4"), // ceiling 95.0, 18 total reps
        log("2026-01-08", "70*8/8/8"), // below the ceiling — no reset
        log("2026-01-15", "72*8/6/4"), // below the ceiling — no reset
        log("2026-02-19", "75*8/8/8"), // ties ceiling + weight, 24 > 18 reps → reset
      ],
    });
    const bench = summary.exercises.find((e) => e.slug === "bench")!;
    expect(bench.stalledWeeks).toBe(0);
    expect(bench.lastPRDate).toBe("2026-02-19");
    expect(bench.lastPRKind).toBe("performance"); // reps tiebreak, not a new ceiling
  });

  it("a plain tie of the ceiling resets the stall clock WITHOUT counting as a PR", () => {
    // 80×8 sets the ceiling. Weeks later 80×8 again: no new axis (same e1RM,
    // same weight, same reps) → not a PR, lastPRDate stays on the original —
    // but the capability is proven again, so stalledWeeks resets. "Stalled"
    // means "hasn't come back to their best", not "hasn't exceeded it".
    const summary = computeStrengthSummary({
      bench: [
        log("2026-01-01", "80*8"), // ceiling + heaviest
        log("2026-01-08", "70*8"),
        log("2026-01-15", "72*8"),
        log("2026-02-19", "80*8"), // plain tie → clock resets, no PR
      ],
    });
    const bench = summary.exercises.find((e) => e.slug === "bench")!;
    expect(bench.stalledWeeks).toBe(0);
    expect(bench.lastPRDate).toBe("2026-01-01"); // the tie did NOT move the PR
  });

  it("retention reads the best of the last 3 sessions, not the latest alone (Pec Deck case)", () => {
    // Ties the all-time tonnage ceiling two sessions ago, then a lighter
    // rep-scheme day. Latest-only retention would read 83% → watch; the
    // windowed read keeps it at peak — one session's set configuration is
    // noise, not a drop.
    const s = computeStrengthSummary(
      {
        pec: [
          log("2026-04-05", "62.5*12/11/5"), // tonnage 750 — all-time ceiling
          log("2026-05-23", "59*10/10/10"), //  590
          log("2026-06-08", "62.5*8/8/8"), //   500
          log("2026-07-04", "62.5*12/12/7"), // 750 — ties the ceiling
          log("2026-07-08", "62.5*10/10/10"), // 625 — lighter day right after
        ],
      },
      new Set(), // isolation → tonnage axis
    );
    const pec = s.exercises.find((e) => e.slug === "pec")!;
    expect(pec.trend).toBe(1); // window best (750) / all-time best (750)
    expect(pec.status).toBe("improving");
    expect(pec.stalledWeeks).toBe(0); // the 7/04 tie reset the clock
    expect(pec.needsAttention).toBe(false);
  });

  it("the two-axis reset flows through to the Decision Engine's training verdict", () => {
    // The plateau lift is watch + stalled → contributes to a 'declining' verdict.
    const plateau = computeStrengthSummary({
      a: [log("2026-01-01", "80*8"), log("2026-01-08", "70*8"), log("2026-01-15", "72*8"), log("2026-02-19", "60*8")],
      b: [log("2026-01-01", "80*8"), log("2026-01-08", "70*8"), log("2026-01-15", "72*8"), log("2026-02-19", "60*8")],
    });
    expect(buildTrainingEvaluation(plateau).trend).toBe("declining");
  });

  it("a majority PRing reads 'improving' even with a rebounding watch lift", () => {
    // Two lifts PRing on their latest session + one watch lift that's below PR
    // but visibly climbing back (rebounding → needsAttention false). The old
    // `watch === 0` gate mislabelled this "holding"; a lagging-but-recovering
    // lift shouldn't veto a block that's otherwise all PRs.
    const block = computeStrengthSummary({
      press: [log("2026-01-01", "50*8"), log("2026-01-20", "54*8"), log("2026-02-01", "57*8"), log("2026-02-15", "60*8")],
      hinge: [log("2026-01-01", "90*8"), log("2026-01-20", "94*8"), log("2026-02-01", "97*8"), log("2026-02-15", "100*8")],
      squat: [log("2026-01-01", "80*8"), log("2026-01-20", "60*8"), log("2026-02-01", "65*8"), log("2026-02-15", "70*8")],
    });
    expect(block.exercises.find((e) => e.slug === "squat")!.needsAttention).toBe(false);
    expect(buildTrainingEvaluation(block).trend).toBe("improving");
  });
});

describe("computeStrengthSummary — trajectory (trend layer)", () => {
  it("a flat lift at PR reads status 'improving' but trajectory 'stable' (velocity 0)", () => {
    // Every session ties the ceiling → pct = 1.0 → status improving. But nothing
    // is climbing: the trajectory must say so, not inherit the status's optimism.
    const s = computeStrengthSummary({
      bench: [log("2026-01-01", "70*8"), log("2026-01-08", "70*8"), log("2026-01-15", "70*8"), log("2026-01-22", "70*8")],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.status).toBe("improving"); // at PR every session
    expect(bench.trajectory.direction).toBe("stable");
    expect(bench.trajectory.velocity).toBe(0); // no trusted run → no slope
  });

  it("a monotonic climb reads 'recovering' with positive velocity, even while at PR", () => {
    // Direction is a superset of the `recovering` FIELD: the field is gated on
    // watch (false here — the lift is at PR each session), the trajectory still
    // reports the climb.
    const s = computeStrengthSummary({
      bench: [log("2026-01-01", "70*8"), log("2026-01-08", "72*8"), log("2026-01-15", "74*8"), log("2026-01-22", "76*8")],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.recovering).toBe(false); // field is watch-gated
    expect(bench.trajectory.direction).toBe("recovering");
    expect(bench.trajectory.velocity).toBeGreaterThan(0);
  });

  it("a consecutive slide reads 'declining' with negative velocity", () => {
    const s = computeStrengthSummary({
      bench: [log("2026-01-01", "80*8"), log("2026-01-08", "78*8"), log("2026-01-15", "76*8"), log("2026-01-22", "74*8")],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.trajectory.direction).toBe("declining");
    expect(bench.trajectory.velocity).toBeLessThan(0);
    expect(bench.declining).toBe(true); // agrees with the flag
  });

  it("confidence rewards dense cadence and penalises sparse logging", () => {
    // Same climb, same 4 sessions — only the spacing differs. Weekly logging is a
    // trustworthy window; the same lift touched every ~7 weeks is not.
    const dense = computeStrengthSummary({
      bench: [log("2026-01-01", "70*8"), log("2026-01-08", "72*8"), log("2026-01-15", "74*8"), log("2026-01-22", "76*8")],
    }).exercises.find((e) => e.slug === "bench")!;
    const sparse = computeStrengthSummary({
      bench: [log("2026-01-01", "70*8"), log("2026-02-15", "72*8"), log("2026-04-01", "74*8"), log("2026-05-20", "76*8")],
    }).exercises.find((e) => e.slug === "bench")!;
    expect(dense.trajectory.confidence).toBeGreaterThan(sparse.trajectory.confidence);
    expect(sparse.trajectory.confidence).toBeLessThan(0.5);
    expect(dense.trajectory.confidence).toBeGreaterThan(0.7);
  });
});

describe("computeStrengthSummary — needs-attention gating (recent-PR grace)", () => {
  it("a watch lift that PR'd within the grace window is NOT flagged (the Assisted Pullup case)", () => {
    // The PR sits OUTSIDE the 3-session retention window (so the lift reads
    // watch) but only ~2 weeks back on the calendar — the stall-clock grace
    // keeps it off the red list. Post-PR sessions are non-monotonic so neither
    // the declining flag nor the recovery override fires.
    const s = computeStrengthSummary({
      bench: [
        log("2026-06-01", "70*8"),
        log("2026-06-15", "76*8"), // fresh PR on both axes
        log("2026-06-20", "65*8"),
        log("2026-06-27", "63*8"),
        log("2026-07-04", "66*8"), // window best 66×8 → ~87% of PR
      ],
    });
    const bench = s.exercises.find((e) => e.slug === "bench")!;
    expect(bench.status).toBe("watch"); // recent window is below 94% of PR
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

  it("a light-day dip mid-run does NOT break recovery (waved loads, the Squat case)", () => {
    // 70→60→80×8 after a 100×8 PR: the 60 is an interleaved light day, and the
    // latest clears BOTH earlier sessions. The old strict two-step gate
    // (prior ≤ mid < latest) could never fire for heavy/light waving — the
    // light day broke the monotone run forever.
    const s = computeStrengthSummary({
      squat: [
        log("2026-01-01", "100*8"), // PR on both axes → stall clock starts here
        log("2026-01-20", "70*8"),
        log("2026-02-01", "60*8"), // light day
        log("2026-02-15", "80*8"), // the run's high — climbing through the wave
      ],
    });
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.status).toBe("watch"); // still ~80% of PR
    expect(squat.recovering).toBe(true);
    expect(squat.needsAttention).toBe(false); // → rescued from the red list
    expect(squat.trajectory.direction).toBe("recovering");
  });

  it("a bounce that doesn't clear the recent high does NOT count as recovery", () => {
    // 90→75→85×8: the latest rebounds off the trough but is still below the 90
    // it fell from — one partial bounce, not a climb back. Stays flagged so
    // noise can't clear a genuinely stuck lift.
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

describe("computeStrengthSummary — isolation scores on tonnage, not e1RM", () => {
  // The motivating bug: a lateral raise PRs at 14×12 (e1RM 19.6, tonnage 168),
  // then the user deliberately shifts to a higher-rep block (10×16-ish: e1RM
  // ~15, tonnage ~150-160). On e1RM that's ~78% retention → watch/declining — a
  // FALSE positive from a programming change. On tonnage it's ~95% → on track.
  // Three post-PR sessions so the PR sits outside the 3-session retention
  // window and the verdict comes from the high-rep block itself.
  const isoLogs = {
    lateral: [
      log("2026-05-01", "12*12"),
      log("2026-05-15", "13*12"),
      log("2026-06-01", "14*12"), // PR: e1RM 19.6, tonnage 168
      log("2026-06-15", "10*16"), // rep-target change: e1RM ~15.3, tonnage 160
      log("2026-06-22", "9*16"), //  e1RM ~13.8, tonnage 144
      log("2026-07-01", "10*15"), // e1RM ~15.0, tonnage 150
    ],
  };

  it("isolation (not in the compound set) is NOT flagged for a rep-target change", () => {
    const s = computeStrengthSummary(isoLogs, new Set()); // lateral = isolation
    const lat = s.exercises.find((e) => e.slug === "lateral")!;
    expect(lat.trend).toBeGreaterThan(0.94); // ~0.95 tonnage retention → stable
    expect(lat.status).not.toBe("watch");
    expect(lat.needsAttention).toBe(false);
    expect(lat.declining).toBe(false);
  });

  it("the SAME logs, judged as compound (e1RM), DO read as a drop", () => {
    const s = computeStrengthSummary(isoLogs, new Set(["lateral"]));
    const lat = s.exercises.find((e) => e.slug === "lateral")!;
    expect(lat.trend).toBeLessThan(0.94); // e1RM retention tanks on the rep shift
    expect(lat.status).toBe("watch");
  });

  it("a new best-set tonnage ceiling is a Hypertrophy PR that resets the clock", () => {
    const s = computeStrengthSummary(
      {
        lateral: [
          log("2026-05-01", "10*15"), // tonnage 150
          log("2026-05-15", "10*12"), // 120 — below
          log("2026-06-01", "10*13"), // 130 — below
          log("2026-07-01", "12*15"), // tonnage 180 → new ceiling, latest session
        ],
      },
      new Set(), // isolation
    );
    const lat = s.exercises.find((e) => e.slug === "lateral")!;
    expect(lat.lastPRKind).toBe("hypertrophy");
    expect(lat.lastPRDate).toBe("2026-07-01");
    expect(lat.stalledWeeks).toBe(0);
    expect(lat.status).toBe("improving");
  });

  it("a real isolation drop (tonnage falls well below peak) still flags", () => {
    const s = computeStrengthSummary(
      {
        lateral: [
          log("2026-05-01", "12*15"), // tonnage 180 (PR)
          log("2026-05-15", "10*14"), // 140
          log("2026-06-01", "9*12"), // 108
          log("2026-07-01", "8*10"), // 80 — a genuine collapse, ~44% of peak
        ],
      },
      new Set(),
    );
    const lat = s.exercises.find((e) => e.slug === "lateral")!;
    expect(lat.status).toBe("watch");
    expect(lat.declining).toBe(true); // consecutive tonnage slide → acute flag
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

  it("stays undefined for an assisted lift even when flagged compound (kg rungs are barbell-only)", () => {
    // Net kg climbs 90→105 and crosses the 100 rung, but the load is assisted
    // (%BW axis) — a round-kg milestone would read the bodyweight-contaminated kg
    // the %BW axis exists to replace, so it's suppressed like machine isolations.
    const assisted = {
      "assist-pull": [
        log("2026-01-01", "110-(20) *5"), // net 90
        log("2026-01-08", "112-(20) *5"), // net 92
        log("2026-01-15", "115-(20) *5"), // net 95
        log("2026-02-01", "125-(20) *5"), // net 105 → would cross 100 if it were barbell
      ],
    };
    const s = computeStrengthSummary(assisted, new Set(["assist-pull"]));
    const ex = s.exercises.find((e) => e.slug === "assist-pull")!;
    expect(ex.lastPRKind).toBe("strength"); // still a PR — only the kg milestone is gone
    expect(ex.milestoneKg).toBeUndefined();
  });

  it("scores an assisted compound on plain %BW — same %BW at fewer reps is NOT a decline", () => {
    // All four sessions lift 80% BW; only reps differ (10 → 5). Under Epley the
    // ×10 session would project 106.7 vs 93.3 for ×5 and the lift would read as
    // sliding below peak — the exact phantom 58f20d9 removed from logic.ts.
    const s = computeStrengthSummary(
      {
        "assist-pull": [
          log("2026-01-01", "100-(20) *10"), // 80% BW × 10
          log("2026-01-08", "100-(20) *5"),
          log("2026-01-15", "100-(20) *5"),
          log("2026-02-01", "100-(20) *5"),
        ],
      },
      new Set(["assist-pull"]),
    );
    const ex = s.exercises.find((e) => e.slug === "assist-pull")!;
    expect(ex.prE1RM).toBeCloseTo(80, 5);     // plain %BW, never Epley(%BW)
    expect(ex.latestE1RM).toBeCloseTo(80, 5); // holding 80% BW = full retention
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

describe("computeStrengthSummary — display name", () => {
  const logs = {
    rdl: [log("2026-01-01", "80*8"), log("2026-01-08", "80*8"), log("2026-01-15", "80*8"), log("2026-01-22", "80*8")],
  };

  it("uses the real stored name when a slug->name map is supplied, even an all-caps acronym", () => {
    const s = computeStrengthSummary(logs, undefined, { rdl: "RDL" });
    expect(s.exercises.find((e) => e.slug === "rdl")!.name).toBe("RDL");
  });

  it("falls back to title-casing the slug when no name map is supplied", () => {
    const s = computeStrengthSummary(logs);
    expect(s.exercises.find((e) => e.slug === "rdl")!.name).toBe("Rdl");
  });
});

describe("computeStrengthSummary — settled stalls (attention expiry)", () => {
  it("a stable stall aged ≥12 weeks settles: off the attention list, settled flag on", () => {
    // Peak at 100×8, then ~90%-of-PR holds scattered over 15 weeks — no decline,
    // no recovery, just a new baseline. The stall said its piece for 12 weeks;
    // it must not nag forever ("stalled 41 wks" every week is noise).
    const s = computeStrengthSummary({
      squat: [
        log("2026-01-01", "100*8"), // PR on both axes → stall clock starts here
        log("2026-01-15", "88*8"),
        log("2026-02-15", "90*8"),
        log("2026-03-15", "88*8"),
        log("2026-04-18", "89*8"), // ~15 wks after the peak, still ~90% — settled
      ],
    });
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.status).toBe("watch"); // still genuinely below PR
    expect(squat.stalledWeeks).toBeGreaterThanOrEqual(12);
    expect(squat.declining).toBe(false);
    expect(squat.settled).toBe(true);
    expect(squat.needsAttention).toBe(false); // the flag expired
    expect(s.attention).toBe(0);
  });

  it("the same stall under 12 weeks is still flagged (not settled)", () => {
    const s = computeStrengthSummary({
      squat: [
        log("2026-01-01", "100*8"),
        log("2026-01-15", "88*8"),
        log("2026-02-01", "90*8"),
        log("2026-02-19", "89*8"), // ~7 wks after the peak — fresh enough to flag
      ],
    });
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.settled).toBe(false);
    expect(squat.needsAttention).toBe(true);
    expect(s.attention).toBe(1);
  });

  it("a settled lift no longer vetoes the engine's 'improving' verdict", () => {
    // Two lifts PRing on their latest session + one lift parked ~10% below peak
    // for months with no slide. Before the expiry that stall held the whole
    // block at "holding" forever; a long-accepted baseline is not evidence the
    // CURRENT block is failing.
    const s = computeStrengthSummary({
      press: [log("2026-01-01", "50*8"), log("2026-01-20", "54*8"), log("2026-02-01", "57*8"), log("2026-04-18", "60*8")],
      hinge: [log("2026-01-01", "90*8"), log("2026-01-20", "94*8"), log("2026-02-01", "97*8"), log("2026-04-18", "100*8")],
      squat: [log("2026-01-01", "100*8"), log("2026-01-15", "88*8"), log("2026-02-15", "90*8"), log("2026-04-18", "89*8")],
    });
    expect(s.exercises.find((e) => e.slug === "squat")!.settled).toBe(true);
    expect(s.attention).toBe(0);
    expect(buildTrainingEvaluation(s).trend).toBe("improving");
  });

  it("an acute decline re-flags an aged stall — settled never masks a live slide", () => {
    const s = computeStrengthSummary({
      squat: [
        log("2026-01-01", "100*8"),
        log("2026-02-01", "92*8"),
        log("2026-03-01", "90*8"),
        log("2026-04-18", "88*8"), // 92→90→88: consecutive slide into the latest session
      ],
    });
    const squat = s.exercises.find((e) => e.slug === "squat")!;
    expect(squat.stalledWeeks).toBeGreaterThanOrEqual(12); // aged past the expiry…
    expect(squat.declining).toBe(true); // …but actively sliding
    expect(squat.settled).toBe(false);
    expect(squat.needsAttention).toBe(true);
  });
});
