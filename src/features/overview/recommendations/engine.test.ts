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
import type { LeanMassEvaluation, GoalStatusEvaluation } from "@features/overview/goal";
import type { PhaseTriggerResult, PhaseTrigger } from "@features/overview/phaseTriggers";

function nutrition(
  over: {
    status?: EvalStatus;
    observedRate?: number;
    min?: number;
    max?: number;
    confidence?: Confidence;
    daysOnTarget?: number;
    cutMode?: string;
  } = {},
): NonNullable<RecContext["nutrition"]> {
  const evaluation: NutritionEvaluation = {
    status: over.status ?? "on_target",
    observedRate: over.observedRate ?? -0.5,
    targetRange: { min: over.min ?? 0.4, max: over.max ?? 0.7 },
    confidence: over.confidence ?? "high",
    evaluatedAt: "2026-07-01T00:00:00.000Z",
    accelDirection: null,
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
    loggedIntake: null,
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
): TrainingEvaluation => ({
  trend,
  confidence,
  watch: trend === "declining" ? 2 : 0,
  total: 4,
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

  it("2b: stalled but adhering → increase activity (overrides 'cut more')", () => {
    const rec = decide({
      nutrition: nutrition({ status: "below_target", observedRate: -0.05, confidence: "high", daysOnTarget: 20 }),
    });
    expect(rec?.title).toBe("Increase activity");
    expect(rec?.source).toBe("weight");
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
    expect(rec?.title).toBe("Push for a PR this week");
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

  it("holds 'Increase activity' near the band edge once it's showing", () => {
    // loss 0.30, band [0.40,0.70]: on_pace at the enter-margin (min−0.15=0.25),
    // but slow at the exit-margin (min−0.05=0.35) — so it only holds with a prior.
    const ctx: RecContext = {
      nutrition: nutrition({ status: "below_target", observedRate: -0.3, confidence: "high", daysOnTarget: 30 }),
    };
    expect(decide(ctx)?.title).not.toBe("Increase activity");
    expect(decide(ctx, priorRec("Increase activity"))?.title).toBe("Increase activity");
  });
});
