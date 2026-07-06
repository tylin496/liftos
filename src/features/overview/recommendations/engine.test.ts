import { describe, it, expect } from "vitest";
import { decide } from "./engine";
import type { RecContext } from "./types";
import type {
  NutritionEvaluation,
  NutritionDiagnostics,
  EvalStatus,
  Confidence,
} from "@features/nutrition/evaluation";
import type { RecoveryEvaluation, RecoveryStatus } from "@features/health/math";
import type { TrainingEvaluation } from "@features/overview/strength";
import type { LeanMassEvaluation } from "@features/overview/goal";

function nutrition(
  over: {
    status?: EvalStatus;
    observedRate?: number;
    min?: number;
    max?: number;
    confidence?: Confidence;
    daysOnTarget?: number;
  } = {},
): NonNullable<RecContext["nutrition"]> {
  const evaluation: NutritionEvaluation = {
    status: over.status ?? "on_target",
    observedRate: over.observedRate ?? -0.5,
    targetRange: { min: over.min ?? 0.4, max: over.max ?? 0.7 },
    confidence: over.confidence ?? "high",
    evaluatedAt: "2026-07-01T00:00:00.000Z",
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2800,
    estimatedIntake: 2400,
    intakeDifference: 0,
    calorieTarget: 2145,
    cutMode: "Moderate Cut",
    windowDays: 21,
    weightDataPoints: 21,
    longestGap: 1,
    daysOnTarget: over.daysOnTarget ?? 30,
  };
  return { evaluation, diagnostics };
}

const recovery = (
  status: RecoveryStatus | null,
  trainingLoad: RecoveryEvaluation["trainingLoad"] = null,
): RecoveryEvaluation => ({
  status,
  score: status === "Needs Recovery" ? 0 : status === "Ready" ? 3 : 2,
  trainingLoad,
});

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
