import { describe, it, expect } from "vitest";
import { sessionMilestoneReached } from "./sessionMilestone";

function datesUpTo(n: number): Set<string> {
  const dates = new Set<string>();
  for (let i = 0; i < n; i++) dates.add(`2024-01-${String(i + 1).padStart(2, "0")}`);
  return dates;
}

describe("sessionMilestoneReached", () => {
  it("crossing the 100th distinct day fires", () => {
    expect(sessionMilestoneReached(datesUpTo(99), "2024-04-01")).toBe(100);
  });
  it("not yet at a rung does not fire", () => {
    expect(sessionMilestoneReached(datesUpTo(50), "2024-04-01")).toBeNull();
    expect(sessionMilestoneReached(datesUpTo(98), "2024-04-01")).toBeNull();
  });
  it("logging on an already-seen date never fires, even at a rung count", () => {
    const prior = datesUpTo(100); // already has 100 distinct dates
    expect(sessionMilestoneReached(prior, "2024-01-05")).toBeNull(); // re-logs an existing date
  });
  it("fires again at the next rung (200)", () => {
    expect(sessionMilestoneReached(datesUpTo(199), "2024-07-18")).toBe(200);
  });
  it("no milestone with an empty history below the first rung", () => {
    expect(sessionMilestoneReached(new Set(), "2024-01-01")).toBeNull();
  });
});
