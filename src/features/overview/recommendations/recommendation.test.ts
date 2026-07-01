import { describe, it, expect } from "vitest";
import { nutritionProvider } from "./nutrition";
import { deriveRecommendations, topRecommendation } from "./index";
import type { RecContext } from "./types";
import type { NutritionEvaluation, NutritionDiagnostics, EvalStatus, Confidence } from "@features/nutrition/evaluation";

function ctx(status: EvalStatus, confidence: Confidence, calorieTarget = 2145): RecContext {
  const evaluation: NutritionEvaluation = {
    status,
    observedRate: -0.3,
    targetRange: { min: 0.4, max: 0.7 },
    confidence,
    evaluatedAt: "2026-07-01T00:00:00.000Z",
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2800,
    estimatedIntake: 2400,
    intakeDifference: 255,
    calorieTarget,
    cutMode: "Moderate Cut",
    windowDays: 21,
    weightDataPoints: 21,
  };
  return { nutrition: { evaluation, diagnostics } };
}

describe("nutritionProvider — derives the action from the evaluation", () => {
  it("proposes a cut only at high confidence + below_target", () => {
    const rec = nutritionProvider(ctx("below_target", "high"))!;
    expect(rec.title).toMatch(/reduce target to 2,045/i);
    expect(rec.priority).toBe(72);
  });

  it("holds (no change) at medium confidence even when below_target", () => {
    const rec = nutritionProvider(ctx("below_target", "medium"))!;
    expect(rec.title).toMatch(/^hold/i);
    expect(rec.priority).toBe(55);
  });

  it("proposes an increase at high confidence + above_target", () => {
    const rec = nutritionProvider(ctx("above_target", "high"))!;
    expect(rec.title).toMatch(/increase target to 2,295/i);
    expect(rec.priority).toBe(70);
  });

  it("maintains on target", () => {
    const rec = nutritionProvider(ctx("on_target", "high"))!;
    expect(rec.title).toMatch(/^maintain/i);
    expect(rec.priority).toBe(30);
  });

  it("never proposes a change at low confidence, whatever the status", () => {
    const rec = nutritionProvider(ctx("below_target", "low"))!;
    expect(rec.title).toMatch(/^maintain/i);
    expect(rec.priority).toBe(40);
  });

  it("returns null with no nutrition input", () => {
    expect(nutritionProvider({})).toBeNull();
  });
});

describe("registry", () => {
  it("sorts by priority desc and topRecommendation takes the most urgent", () => {
    const recs = deriveRecommendations(ctx("below_target", "high"));
    expect(recs.length).toBe(1);
    expect(topRecommendation(ctx("below_target", "high"))?.priority).toBe(72);
  });

  it("yields no recommendations when every provider abstains", () => {
    expect(deriveRecommendations({})).toEqual([]);
    expect(topRecommendation({})).toBeNull();
  });
});
