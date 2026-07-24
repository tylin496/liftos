import { describe, it, expect } from "vitest";
import { normalizeTarget, parseAssist } from "./logFormHelpers";

describe("parseAssist — assistance takes the same arithmetic as the weight hero", () => {
  it("evaluates expressions, not just the leading number", () => {
    expect(parseAssist("19+5")).toBe(24);
    expect(parseAssist("12x2")).toBe(24);
    expect(parseAssist("19.5")).toBe(19.5);
  });

  it("reads blank / half-typed / non-positive input as 0", () => {
    expect(parseAssist("")).toBe(0);
    expect(parseAssist("19+")).toBe(0);
    expect(parseAssist("-5")).toBe(0);
  });
});

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
