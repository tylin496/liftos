import { describe, it, expect } from "vitest";
import { decide } from "./engine";
import type { RecContext, Recommendation } from "./types";
import type {
  NutritionEvaluation,
  NutritionDiagnostics,
  EvalStatus,
  Confidence,
} from "@features/nutrition/evaluation";
import type { RecoveryEvaluation, RecoveryStatus } from "@features/health/math";
import type { TrainingEvaluation } from "@features/overview/strength";
import type {
  LeanMassEvaluation,
  GoalStatusEvaluation,
  BulkGoalStatusEvaluation,
  BodyFatTrendEvaluation,
} from "@features/overview/goal";
import type { PhaseTriggerResult, PhaseTrigger } from "@features/overview/phaseTriggers";
import { phaseKindFromName } from "@features/nutrition/logic";

function nutrition(
  over: {
    status?: EvalStatus;
    observedRate?: number;
    min?: number;
    max?: number;
    confidence?: Confidence;
    daysOnTarget?: number;
    cutMode?: string;
    accelDirection?: "faster" | "slowing" | null;
    /** Mean daily logged intake. null (the default) = no food-log signal. */
    loggedIntake?: number | null;
  } = {},
): NonNullable<RecContext["nutrition"]> {
  const evaluation: NutritionEvaluation = {
    status: over.status ?? "on_target",
    observedRate: over.observedRate ?? -0.5,
    targetRange: { min: over.min ?? 0.4, max: over.max ?? 0.7 },
    // Derived from cutMode exactly like rowToState, so phase-gated rungs see
    // the same kind the production path would.
    phaseKind: phaseKindFromName(over.cutMode ?? "Moderate Cut"),
    confidence: over.confidence ?? "high",
    evaluatedAt: "2026-07-01T00:00:00.000Z",
    accelDirection: over.accelDirection ?? null,
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2800,
    estimatedIntake: 2400,
    intakeDifference: 0,
    calorieTarget: 2145,
    cutMode: over.cutMode ?? "Moderate Cut",
    windowDays: 21,
    weightDataPoints: 21,
    longestGap: 1,
    loggedIntake: over.loggedIntake ?? null,
    intakeGap: null,
    daysOnTarget: over.daysOnTarget ?? 30,
  };
  return { evaluation, diagnostics };
}

const recovery = (
  status: RecoveryStatus | null,
  trainingLoad: RecoveryEvaluation["trainingLoad"] = null,
): RecoveryEvaluation => ({
  status,
  score: status === "Ready" ? 3 : status === "Good" ? 2 : status === "Fair" ? 1 : 0,
  trainingLoad,
});

const priorRec = (title: string): Recommendation => ({ source: "weight", priority: 0, title, subtitle: "" });

const training = (
  trend: TrainingEvaluation["trend"],
  confidence: TrainingEvaluation["confidence"] = "high",
  watch = trend === "declining" ? 2 : 0,
  leader: TrainingEvaluation["leader"] = null,
  /** Lifts actually needing intervention (≤ watch). Defaults to the realistic
   *  shape: a "declining" verdict IS built from stalled watch lifts, while a
   *  healthy block's watch lifts are fresh-PR/rebounding/settled → none. */
  attention = trend === "declining" ? watch : 0,
): TrainingEvaluation => ({
  trend,
  confidence,
  watch,
  attention,
  improving: trend === "improving" ? 4 - watch : 0,
  total: 4,
  leader,
});

const leanMass = (
  trend: LeanMassEvaluation["trend"],
  confidence: LeanMassEvaluation["confidence"] = "high",
): LeanMassEvaluation => ({ trend, slopePerMonth: trend === "falling" ? -0.3 : 0, confidence });

const phase = (firingCount: number): PhaseTriggerResult => ({
  triggers: (["weight_stall", "strength_decline", "recovery_worsening", "adherence_slipping"] as const).map(
    (key, i): PhaseTrigger => ({ key, label: key, state: i < firingCount ? "firing" : "ok", detail: "" }),
  ),
  firingCount,
});

const goal = (
  reached: boolean,
  bodyFat14dAvg: number | null = 17.8,
  targetBodyFatPct: number | null = 18,
): GoalStatusEvaluation => ({ reached, bodyFat14dAvg, targetBodyFatPct });

describe("Decision Engine — precedence ladder", () => {
  it("abstains on an empty context", () => {
    expect(decide({})).toBeNull();
  });

  // ─ Tier 1 — Protect ─────────────────────────────────────────────────────────
  it("1a: a settled recovery dip outranks a nutrition correction", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.3, confidence: "high" }),
      recovery: recovery("Needs Recovery", "trained"),
    });
    expect(rec?.source).toBe("recovery");
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("1a: fires on low readiness alone — no training decline required", () => {
    expect(decide({ recovery: recovery("Needs Recovery", "rested") })?.title).toBe("Prioritize recovery");
  });

  it("1b: confident falling lean mass → hold off on further cuts", () => {
    const rec = decide({ nutrition: nutrition(), recovery: recovery("Good"), leanMass: leanMass("falling") });
    expect(rec?.title).toBe("Hold off on further cuts");
    expect(rec?.source).toBe("weight");
  });

  it("1a beats 1b when both fire (recovery is more time-sensitive)", () => {
    const rec = decide({ recovery: recovery("Needs Recovery"), leanMass: leanMass("falling") });
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("low-confidence lean mass never fires the hold-cuts tier", () => {
    const rec = decide({ nutrition: nutrition(), leanMass: leanMass("falling", "low") });
    expect(rec?.title).not.toBe("Hold off on further cuts");
    expect(rec?.title).toBe("No action needed");
  });

  it("1b does not fire in maintenance — 'pause the deficit' is meaningless with no deficit", () => {
    const rec = decide({
      nutrition: nutrition({ cutMode: "Maintenance" }),
      leanMass: leanMass("falling"),
    });
    expect(rec?.title).not.toBe("Hold off on further cuts");
  });

  // ─ Tier 2 — Correct ─────────────────────────────────────────────────────────
  it("2a: losing too fast AND training declining → reduce deficit (the joint verdict)", () => {
    const rec = decide({
      nutrition: nutrition({ status: "above_target", observedRate: -1.0, confidence: "high" }),
      training: training("declining"),
      recovery: recovery("Good"),
    });
    expect(rec?.title).toBe("Reduce deficit slightly");
    expect(rec?.source).toBe("nutrition");
    expect(rec?.priority).toBe(71);
  });

  it("losing too fast WITHOUT a training cost → nutrition's own ease-deficit, not the joint 2a", () => {
    const rec = decide({
      nutrition: nutrition({ status: "above_target", observedRate: -1.0, confidence: "high" }),
      training: training("holding"),
    });
    expect(rec?.title).toBe("Review calorie target");
    expect(rec?.title).not.toBe("Reduce deficit slightly");
  });

  it("2b: stalled + adhering + lifts DECLINING → increase activity (muscle guardrail)", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
      training: training("declining"),
    });
    expect(rec?.title).toBe("Increase activity");
    expect(rec?.source).toBe("weight");
  });

  it("2b: stalled + adhering + lifts SAFE → nutrition's reduce (lower the target, not add activity)", () => {
    // Logging offset is ~constant, so lowering the target is a valid lever; only a
    // declining lift trend diverts to 'add activity'.
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
      training: training("holding"),
    });
    expect(rec?.title).toBe("Review calorie target");
    expect(rec?.title).not.toBe("Increase activity");
  });

  it("2b: stalled + adhering + one lift NEEDING ATTENTION (not yet a decline) → still holds off the cut", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
      // holding overall, but one lift is stalled ≥3 wks and still asking for help
      training: training("holding", "high", 1, null, 1),
    });
    expect(rec?.title).toBe("Increase activity");
  });

  it("2b: lifts merely on WATCH with none needing attention is NOT softening — the cut lever stays open", () => {
    // The shape of a healthy block: a couple of lifts under 94% of PR because
    // they're fresh off a PR / rebounding / a settled 12-week baseline. Gating on
    // raw `watch` made the guardrail unconditional for anyone with a dozen lifts.
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
      training: training("holding", "high", 3, null, 0),
    });
    expect(rec?.title).toBe("Review calorie target");
    expect(rec?.title).not.toBe("Increase activity");
  });

  it("2b-pre: stalled with the log sitting OVER target → hit the target, don't move it", () => {
    // The failure `daysOnTarget` alone can't see: target set three weeks ago and
    // never touched (so it reads as "adherent"), while ~400 kcal/day more than it
    // gets eaten every day. Neither lowering the target nor prescribing cardio is
    // the answer to a plan that isn't being run.
    const rec = decide({
      nutrition: nutrition({
        status: "below_target",
        observedRate: -0.05,
        confidence: "high",
        daysOnTarget: 20,
        loggedIntake: 2545, // target 2145
      }),
      training: training("declining"), // would otherwise divert to activity
    });
    expect(rec?.title).toBe("Hit your current target");
    expect(rec?.subtitle).toContain("400 kcal/day over target");
  });

  it("2b-pre: a log at/below target can't overrule adherence — only a clear overshoot does", () => {
    // The log is a systematic UNDER-count, so "logged ≈ target" proves nothing and
    // must leave the existing verdict alone; only the conclusive direction bites.
    const rec = decide({
      nutrition: nutrition({
        status: "below_target",
        observedRate: -0.05,
        confidence: "high",
        daysOnTarget: 20,
        loggedIntake: 2100, // under target
      }),
      training: training("declining"),
    });
    expect(rec?.title).toBe("Increase activity");
  });

  it("2b-pre: an overshoot inside the log's own precision doesn't fire", () => {
    const rec = decide({
      nutrition: nutrition({
        status: "below_target",
        observedRate: -0.05,
        confidence: "high",
        daysOnTarget: 20,
        loggedIntake: 2200, // +55/day — can't explain a stall
      }),
      training: training("declining"),
    });
    expect(rec?.title).toBe("Increase activity");
  });

  it("2b-pre bulk mirror: a slow gain with the log UNDER target → hit the target, don't raise it", () => {
    const rec = decide({
      nutrition: nutrition({
        cutMode: "Lean Bulk",
        status: "below_target",
        observedRate: 0.02,
        min: 0.2,
        max: 0.4,
        confidence: "high",
        daysOnTarget: 20,
        loggedIntake: 1845, // 300 under target
      }),
    });
    expect(rec?.title).toBe("Hit your current target");
    expect(rec?.subtitle).toContain("under target");
  });

  it("stalled but NOT adhering → falls through to nutrition (activity isn't the fix)", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 2 }),
    });
    expect(rec?.title).not.toBe("Increase activity");
    expect(rec?.title).toBe("Review calorie target");
  });

  // ─ Tier 3 / 4 — Sustain vs Capitalize ───────────────────────────────────────
  it("4: on plan + recovery strong + lifts rising → push for a PR", () => {
    const rec = decide({
      nutrition: nutrition({ status: "on_target", confidence: "high" }),
      recovery: recovery("Ready"),
      training: training("improving"),
    });
    // No trusted climber to name → the concrete count carries the directive.
    expect(rec?.title).toBe("Add weight this week");
    expect(rec?.subtitle).toContain("4 of 4 lifts at their best");
    expect(rec?.source).toBe("training");
  });

  it("4: names the leading lift + its current best when one is climbing", () => {
    const rec = decide({
      nutrition: nutrition({ status: "on_target", confidence: "high" }),
      recovery: recovery("Ready"),
      training: training("improving", "high", 0, { name: "Squat", detail: "140 kg × 5" }),
    });
    expect(rec?.title).toBe("Push Squat past 140 kg × 5");
    expect(rec?.subtitle).toContain("Squat's climbing steadily with room left");
    expect(rec?.subtitle).toContain("beat your 140 kg × 5");
    expect(rec?.source).toBe("training");
  });

  it("3: on plan but lifts merely holding → maintain, not a PR push", () => {
    const rec = decide({
      nutrition: nutrition({ status: "on_target", confidence: "high" }),
      recovery: recovery("Ready"),
      training: training("holding"),
    });
    expect(rec?.title).toBe("No action needed");
  });

  it("PR needs training evidence — absence keeps it at maintain", () => {
    const rec = decide({ nutrition: nutrition({ status: "on_target" }), recovery: recovery("Ready") });
    expect(rec?.title).toBe("No action needed");
  });

  it("4: recovery merely 'Good' (score 2, one marker down) is NOT green enough for a PR push", () => {
    const rec = decide({
      nutrition: nutrition({ status: "on_target", confidence: "high" }),
      recovery: recovery("Good"),
      training: training("improving"),
    });
    // GOOD gate = Ready (score 3) only; a score-2 "Good" holds at maintain.
    expect(rec?.title).toBe("No action needed");
  });
});

describe("Decision Engine — phase directives (maintenance)", () => {
  it("1a′: goal body fat reached → Start maintenance", () => {
    const rec = decide({ nutrition: nutrition(), recovery: recovery("Good"), goal: goal(true) });
    expect(rec?.title).toBe("Start maintenance");
    expect(rec?.source).toBe("phase");
    expect(rec?.subtitle).toContain("18%");
  });

  it("1a beats 1a′: an acute recovery debt outranks the goal (it re-fires later)", () => {
    const rec = decide({ nutrition: nutrition(), recovery: recovery("Needs Recovery"), goal: goal(true) });
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("1a′ beats 1b: at goal, 'Start maintenance' is the complete frame for stopping the deficit", () => {
    const rec = decide({ nutrition: nutrition(), goal: goal(true), leanMass: leanMass("falling") });
    expect(rec?.title).toBe("Start maintenance");
  });

  it("at goal the user is never told to merely 'Consider' — Start pre-empts it", () => {
    const rec = decide({ nutrition: nutrition(), goal: goal(true), phase: phase(4) });
    expect(rec?.title).toBe("Start maintenance");
  });

  it("2-pre: two plateau signals firing → Consider switching to maintenance", () => {
    const rec = decide({ nutrition: nutrition(), recovery: recovery("Good"), phase: phase(2) });
    expect(rec?.title).toBe("Consider switching to maintenance");
    expect(rec?.source).toBe("phase");
    expect(rec?.subtitle).toContain("2 of 4 plateau signals are");
  });

  it("2-pre beats 2b: a stalled-but-adherent dieter with stacked signals is told maintenance, not more activity", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
      phase: phase(2),
    });
    expect(rec?.title).toBe("Consider switching to maintenance");
    expect(rec?.title).not.toBe("Increase activity");
  });

  it("one signal alone does not surface the consideration", () => {
    const rec = decide({ nutrition: nutrition(), phase: phase(1) });
    expect(rec?.title).not.toBe("Consider switching to maintenance");
  });

  it("neither phase directive fires once the user is already at maintenance", () => {
    const maintenance = nutrition({ cutMode: "Maintenance" });
    expect(decide({ nutrition: maintenance, goal: goal(true) })?.title).not.toBe("Start maintenance");
    expect(decide({ nutrition: maintenance, phase: phase(4) })?.title).not.toBe(
      "Consider switching to maintenance",
    );
  });

  it("no nutrition slice → can't confirm a cut → phase directives stay quiet", () => {
    expect(decide({ goal: goal(true), phase: phase(4) })).toBeNull();
  });

  it("no phase/goal slices → the ladder behaves exactly as before (regression)", () => {
    const rec = decide({ nutrition: nutrition({ status: "on_target" }), recovery: recovery("Ready") });
    expect(rec?.title).toBe("No action needed");
  });
});

describe("Decision Engine — phase directive hysteresis", () => {
  it("holds 'Start maintenance' while body fat hovers within the exit margin", () => {
    const ctx: RecContext = {
      nutrition: nutrition(),
      goal: goal(false, 18.2, 18), // drifted 0.2pp back above target
    };
    expect(decide(ctx)?.title).not.toBe("Start maintenance");
    expect(decide(ctx, priorRec("Start maintenance"))?.title).toBe("Start maintenance");
  });

  it("releases 'Start maintenance' once body fat drifts past the margin", () => {
    const rec = decide(
      { nutrition: nutrition(), goal: goal(false, 18.5, 18) },
      priorRec("Start maintenance"),
    );
    expect(rec?.title).not.toBe("Start maintenance");
  });

  it("holds 'Consider' at one remaining signal, drops it at zero", () => {
    const prior = priorRec("Consider switching to maintenance");
    expect(decide({ nutrition: nutrition(), phase: phase(1) }, prior)?.title).toBe(
      "Consider switching to maintenance",
    );
    expect(decide({ nutrition: nutrition(), phase: phase(0) }, prior)?.title).not.toBe(
      "Consider switching to maintenance",
    );
  });
});

describe("Decision Engine — exit hysteresis (no flip-flop)", () => {
  it("holds 'Prioritize recovery' through a dip to Fair once it's showing", () => {
    const rec = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Fair") },
      priorRec("Prioritize recovery"),
    );
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("does NOT surface recovery on a fresh Fair (no prior directive)", () => {
    const rec = decide({ nutrition: nutrition({ status: "on_target" }), recovery: recovery("Fair") });
    expect(rec?.title).not.toBe("Prioritize recovery");
  });

  it("releases recovery once readiness climbs back to Good", () => {
    const rec = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Good") },
      priorRec("Prioritize recovery"),
    );
    expect(rec?.title).not.toBe("Prioritize recovery");
  });

  // Recent training load tunes exit stickiness (see recoveryReleaseScore).
  it("post-training dip releases a step earlier — drops at Fair", () => {
    const rec = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Fair", "trained") },
      priorRec("Prioritize recovery"),
    );
    // Would hold with the default release (null), but training-stress releases at Fair.
    expect(rec?.title).not.toBe("Prioritize recovery");
  });

  it("systemic dip (little training) holds even through Good", () => {
    const rec = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Good", "rested") },
      priorRec("Prioritize recovery"),
    );
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("systemic dip finally releases once readiness is fully back (Ready)", () => {
    const rec = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Ready", "rested") },
      priorRec("Prioritize recovery"),
    );
    expect(rec?.title).not.toBe("Prioritize recovery");
  });

  it("a user dismiss suppresses the recovery rung even at Needs Recovery", () => {
    const base = { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Needs Recovery", "rested") };
    // Sanity: without the dismiss it fires.
    expect(decide(base)?.title).toBe("Prioritize recovery");
    // Dismissed → the ladder falls through, recovery stays silent.
    expect(decide({ ...base, recoveryDismissed: true })?.title).not.toBe("Prioritize recovery");
  });

  it("2a: fast weight + dismissed recovery debt still reduces the deficit (fills the dismiss gap)", () => {
    // With 1a snoozed, a fast cut on a fatigued dieter would otherwise fall to a
    // bland nutrition read. Spec's 'Weight=FAST AND Recovery=POOR' arm catches it.
    const rec = decide({
      nutrition: nutrition({ status: "above_target", observedRate: -1.0, confidence: "high" }),
      recovery: recovery("Needs Recovery", "rested"),
      recoveryDismissed: true,
    });
    expect(rec?.title).toBe("Reduce deficit slightly");
  });

  it("keys hysteresis on the engine's OWN output (guards title/key drift)", () => {
    // Round-trip the real produced directive as `prior` instead of a hand-typed
    // string: if the recovery provider's title and the engine's RECOVERY_TITLE key
    // ever diverge, the hold silently breaks and this fails.
    const first = decide({ recovery: recovery("Needs Recovery", "rested") });
    expect(first?.title).toBe("Prioritize recovery");
    const held = decide(
      { nutrition: nutrition({ status: "on_target" }), recovery: recovery("Good", "rested") },
      first, // systemic dip holds through Good — but only if key === produced title
    );
    expect(held?.title).toBe("Prioritize recovery");
  });

  it("holds 'Increase activity' (the muscle guardrail) near the band edge once it's showing", () => {
    // loss 0.30, band [0.40,0.70]: on_pace at the enter-margin (min−0.15=0.25), but
    // slow at the exit-margin (min−0.05=0.35). Lifts declining, so the slow read
    // yields the guardrail 'Increase activity' — which the hold keeps across the wobble
    // (without a prior it's on_pace → falls through to nutrition's own reduce).
    const ctx: RecContext = {
      nutrition: nutrition({ status: "below_target", observedRate: -0.3, confidence: "high", daysOnTarget: 30 }),
      training: training("declining"),
    };
    expect(decide(ctx)?.title).not.toBe("Increase activity");
    expect(decide(ctx, priorRec("Increase activity"))?.title).toBe("Increase activity");
  });
});

// ── Lean Bulk — the mirrored rungs ────────────────────────────────────────────

/** Bulk-phase nutrition slice: Lean Bulk band [0.1, 0.3] kg/wk of GAIN,
 *  observedRate positive while gaining. */
const bulkNutrition = (
  over: Parameters<typeof nutrition>[0] = {},
): NonNullable<RecContext["nutrition"]> =>
  nutrition({ cutMode: "Lean Bulk", min: 0.1, max: 0.3, observedRate: 0.2, ...over });

const bulkGoal = (
  reached: boolean,
  bodyFat14dAvg: number | null = 20.5,
  bfCeilingPct: number | null = 21,
): BulkGoalStatusEvaluation => ({ reached, bodyFat14dAvg, bfCeilingPct });

const bodyFatTrend = (
  trend: BodyFatTrendEvaluation["trend"],
  confidence: BodyFatTrendEvaluation["confidence"] = "high",
): BodyFatTrendEvaluation => ({
  trend,
  slopePpPerMonth: trend === "rising" ? 1.1 : 0.1,
  confidence,
});

describe("Decision Engine — lean bulk rungs", () => {
  it("an in-band gain is a plain 'No action needed' (never gold-rushed into advice)", () => {
    const rec = decide({ nutrition: bulkNutrition({ status: "on_target" }) });
    expect(rec?.title).toBe("No action needed");
  });

  it("1a″: body fat at the ceiling fires 'Start the cut'", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "on_target" }),
      bulkGoal: bulkGoal(true, 21.2, 21),
    });
    expect(rec?.title).toBe("Start the cut");
    expect(rec?.source).toBe("phase");
  });

  it("1a″ never fires while cutting (phase gates are mutually exclusive)", () => {
    const rec = decide({
      nutrition: nutrition({ status: "on_target" }),
      bulkGoal: bulkGoal(true, 21.2, 21),
    });
    expect(rec?.title).not.toBe("Start the cut");
  });

  it("1a″ holds within the exit margin once showing, releases below it", () => {
    const ctx = (bf14: number): RecContext => ({
      nutrition: bulkNutrition({ status: "on_target" }),
      bulkGoal: bulkGoal(false, bf14, 21),
    });
    // 20.8 ≥ ceiling − 0.3 → held; 20.6 < margin → released.
    expect(decide(ctx(20.8), priorRec("Start the cut"))?.title).toBe("Start the cut");
    expect(decide(ctx(20.6), priorRec("Start the cut"))?.title).not.toBe("Start the cut");
    // Sanity: neither fires fresh (not reached).
    expect(decide(ctx(20.8))?.title).not.toBe("Start the cut");
  });

  it("1a: an acute recovery debt still outranks the bulk's goal rung", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "on_target" }),
      bulkGoal: bulkGoal(true),
      recovery: recovery("Needs Recovery", "trained"),
    });
    expect(rec?.title).toBe("Prioritize recovery");
  });

  it("2-pre-bulk: stacked plateau signals suggest a maintenance break", () => {
    const rec = decide({ nutrition: bulkNutrition({ status: "on_target" }), phase: phase(2) });
    expect(rec?.title).toBe("Consider a maintenance break");
    // One signal isn't enough to enter…
    expect(decide({ nutrition: bulkNutrition({ status: "on_target" }), phase: phase(1) })?.title).not.toBe(
      "Consider a maintenance break",
    );
    // …but holds an already-showing directive.
    expect(
      decide(
        { nutrition: bulkNutrition({ status: "on_target" }), phase: phase(1) },
        priorRec("Consider a maintenance break"),
      )?.title,
    ).toBe("Consider a maintenance break");
  });

  it("2a-bulk: gaining fast + body fat confidently rising → Reduce surplus", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "above_target", observedRate: 0.5 }),
      bodyFatTrend: bodyFatTrend("rising"),
    });
    expect(rec?.title).toBe("Reduce surplus");
  });

  it("2a-bulk: gaining fast alone (no evidence of cost) falls through to nutrition's own reduce", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "above_target", observedRate: 0.5 }),
      bodyFatTrend: bodyFatTrend("stable", "low"),
    });
    expect(rec?.title).toBe("Review calorie target");
  });

  it("2a-bulk: in-band gain with lean mass confidently FALLING → Reduce surplus (gain isn't lean)", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "on_target", observedRate: 0.2 }),
      leanMass: leanMass("falling"),
    });
    expect(rec?.title).toBe("Reduce surplus");
  });

  it("a stalled bulk never gets 'Increase activity' — the slow-side lever is more food", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "below_target", observedRate: 0.02, daysOnTarget: 30 }),
      training: training("declining"),
    });
    expect(rec?.title).not.toBe("Increase activity");
    expect(rec?.title).toBe("Review calorie target"); // nutrition's own increase
  });

  it("1b 'Hold off on further cuts' stays cut-only (a bulking faller routes to Reduce surplus)", () => {
    const rec = decide({
      nutrition: bulkNutrition({ status: "on_target" }),
      leanMass: leanMass("falling"),
    });
    expect(rec?.title).not.toBe("Hold off on further cuts");
  });
});
