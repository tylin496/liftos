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
    longestGap: 1,
    loggedIntake: null,
    intakeGap: null,
    daysOnTarget: 30,
  };
  return { nutrition: { evaluation, diagnostics } };
}

describe("nutritionProvider — event type + specific action", () => {
  it("surfaces an imperative decision with the reason (no number) at high confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "high"))!;
    expect(rec.title).toBe("Review calorie target");
    expect(rec.subtitle).toBe("Weight loss has slowed");
    expect(rec.subtitle).not.toMatch(/kcal/i); // number lives on the Nutrition card
    expect(rec.priority).toBe(72);
  });

  it("reads as no-action-needed with a reason at medium confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "medium"))!;
    expect(rec.title).toBe("No action needed");
    expect(rec.subtitle).toMatch(/trend isn't confirmed/i);
    expect(rec.subtitle).not.toMatch(/kcal/i);
    expect(rec.priority).toBe(55);
  });

  it("surfaces an imperative decision with the reason when losing too fast", () => {
    const rec = nutritionProvider(ctx("above_target", "high"))!;
    expect(rec.title).toBe("Review calorie target");
    expect(rec.subtitle).toBe("You're losing faster than planned");
    expect(rec.subtitle).not.toMatch(/kcal/i);
    expect(rec.priority).toBe(70);
  });

  it("reads as no-action-needed when on target", () => {
    const rec = nutritionProvider(ctx("on_target", "high"))!;
    expect(rec.title).toBe("No action needed");
    expect(rec.subtitle).toBe("Weight loss remains on plan");
    expect(rec.subtitle).not.toMatch(/kcal/i);
    expect(rec.priority).toBe(30);
  });

  it("reads as no-action-needed at low confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "low"))!;
    expect(rec.title).toBe("No action needed");
    expect(rec.subtitle).toMatch(/gathering data/i);
    expect(rec.subtitle).not.toMatch(/kcal/i);
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
