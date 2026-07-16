import { describe, it, expect } from "vitest";
import { normalizeTarget } from "./logFormHelpers";

describe("normalizeTarget — canonicalize to the 'reps × sets' convention", () => {
  it("unifies the multiply sign and spacing", () => {
    expect(normalizeTarget("6-8x3")).toBe("6-8 × 3");
    expect(normalizeTarget("6-8 X 3")).toBe("6-8 × 3");
    expect(normalizeTarget("12*2")).toBe("12 × 2");
    expect(normalizeTarget("10-12×3")).toBe("10-12 × 3");
  });

  it("unifies range dashes", () => {
    expect(normalizeTarget("6–8 × 3")).toBe("6-8 × 3");
    expect(normalizeTarget("6 - 8 x 3")).toBe("6-8 × 3");
    expect(normalizeTarget("6~8")).toBe("6-8");
  });

  it("already-canonical and sets-less targets pass through", () => {
    expect(normalizeTarget("6-8 × 3")).toBe("6-8 × 3");
    expect(normalizeTarget("10-12")).toBe("10-12");
    expect(normalizeTarget("12")).toBe("12");
  });

  it("free text is left alone (trimmed only) — the field stays free-form", () => {
    expect(normalizeTarget(" 12 × 2 drop set ")).toBe("12 × 2 drop set");
    expect(normalizeTarget("AMRAP")).toBe("AMRAP");
    expect(normalizeTarget("")).toBe("");
  });
});
