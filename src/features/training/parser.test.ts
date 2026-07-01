import { describe, it, expect } from "vitest";
import { normalize, evalArith, parse, score, formatRepsDisplay } from "./parser";

describe("normalize", () => {
  it("converts x/X to × and collapses whitespace", () => {
    expect(normalize("75x12")).toBe("75×12");
    expect(normalize("27X2  *10")).toBe("27×2 *10");
    expect(normalize("  100*5  ")).toBe("100*5");
  });
});

describe("evalArith", () => {
  it("evaluates plain numbers and arithmetic", () => {
    expect(evalArith("75")).toBe(75);
    expect(evalArith("100/2")).toBe(50);
    expect(evalArith("(2+3)*4")).toBe(20);
    expect(evalArith("-5")).toBe(-5);
  });

  it("evaluates normalized × as multiplication", () => {
    expect(evalArith("27×2")).toBe(54);
  });

  it("handles decimals and subtraction (assisted form)", () => {
    expect(evalArith("97.19-(26)")).toBeCloseTo(71.19, 2);
  });

  it("returns NaN for invalid or non-arithmetic input", () => {
    expect(evalArith("abc")).toBeNaN();
    expect(evalArith("")).toBeNaN();
    expect(evalArith("100*")).toBeNaN();
    expect(evalArith(null)).toBeNaN();
  });
});

describe("parse", () => {
  it("parses simple weight*reps", () => {
    const p = parse("75*12");
    expect(p).not.toBeNull();
    expect(p!.weight).toBe(75);
    expect(p!.reps).toBe("12");
    expect(p!.unit).toBeNull();
    expect(p!.assisted).toBeNull();
  });

  it("evaluates a weight expression", () => {
    const p = parse("27×2 *10");
    expect(p!.weight).toBe(54);
    expect(p!.reps).toBe("10");
  });

  it("keeps drop-set rep schemes intact", () => {
    const p = parse("100*10/10/9");
    expect(p!.weight).toBe(100);
    expect(p!.reps).toBe("10/10/9");
  });

  it("captures lbs unit", () => {
    const p = parse("30lbs *8");
    expect(p!.unit).toBe("lbs");
    expect(p!.weight).toBe(30);
    expect(p!.reps).toBe("8");
  });

  it("extracts assisted bodyweight − assistance", () => {
    const p = parse("97.19-(26) *8");
    expect(p!.assisted).toEqual({ bw: 97.19, assist: 26 });
    expect(p!.weight).toBeCloseTo(71.19, 2);
    expect(p!.reps).toBe("8");
  });

  it("returns null for empty or unparseable input", () => {
    expect(parse("")).toBeNull();
    expect(parse("just a note")).toBeNull();
  });

  it("rejects a second multiplier instead of swallowing it as a note", () => {
    expect(parse("100*8*2")).toBeNull();
  });

  it("rejects negative assistance", () => {
    expect(parse("70-(-5)*8")).toBeNull();
  });
});

describe("score", () => {
  it("returns kg weight directly", () => {
    expect(score(parse("75*12"))).toBe(75);
  });

  it("converts lbs to kg", () => {
    expect(score(parse("30lbs *8"))).toBeCloseTo(30 * 0.453592, 4);
  });

  it("returns -Infinity for null / unparseable", () => {
    expect(score(null)).toBe(-Infinity);
    expect(score(parse("just a note"))).toBe(-Infinity);
  });
});

describe("formatRepsDisplay", () => {
  it("collapses uniform drop sets to a single number", () => {
    expect(formatRepsDisplay("10/10/10")).toBe("10");
  });

  it("preserves mixed drop sets", () => {
    expect(formatRepsDisplay("10/10/9")).toBe("10/10/9");
  });

  it("handles single value and empty", () => {
    expect(formatRepsDisplay("12")).toBe("12");
    expect(formatRepsDisplay("")).toBe("");
  });
});
