import { describe, it, expect } from "vitest";
import { milestoneAtOrBelow, milestoneReached } from "./milestone";

describe("milestoneAtOrBelow — rungs tighten with load", () => {
  it("every 10kg under 100", () => {
    expect(milestoneAtOrBelow(60)).toBe(60);
    expect(milestoneAtOrBelow(67)).toBe(60);
    expect(milestoneAtOrBelow(99)).toBe(90);
  });
  it("every 5kg at 100 and above", () => {
    expect(milestoneAtOrBelow(100)).toBe(100);
    expect(milestoneAtOrBelow(104)).toBe(100);
    expect(milestoneAtOrBelow(105)).toBe(105);
    expect(milestoneAtOrBelow(162)).toBe(160);
  });
  it("nothing below the first rung", () => {
    expect(milestoneAtOrBelow(8)).toBe(0);
  });
});

describe("milestoneReached", () => {
  it("crossing 100 for the first time", () => {
    expect(milestoneReached(100, 98)).toBe(100);
  });
  it("crossing a 5kg rung above 100", () => {
    expect(milestoneReached(105, 102)).toBe(105);
  });
  it("a new heaviest that doesn't clear the next rung is not a milestone", () => {
    expect(milestoneReached(104, 101)).toBeNull(); // both floor to 100
    expect(milestoneReached(77, 72)).toBeNull(); // both floor to 70
  });
  it("clearing the next rung fires (heaviest weight axis)", () => {
    expect(milestoneReached(80, 77)).toBe(80);
  });
  it("no milestone when it isn't a new heaviest", () => {
    expect(milestoneReached(90, 100)).toBeNull();
    expect(milestoneReached(100, 100)).toBeNull();
  });
  it("returns the highest rung when several are jumped at once", () => {
    expect(milestoneReached(92, 68)).toBe(90); // crossed 70/80/90 → highest
  });
  it("first-ever heavy set (no prior) crosses to its rung", () => {
    expect(milestoneReached(60, 0)).toBe(60);
  });
});
