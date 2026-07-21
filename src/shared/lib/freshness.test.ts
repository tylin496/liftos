import { describe, it, expect } from "vitest";
import { daysSince, isStale, formatAgo } from "./freshness";

// ISO date `n` days before today, built from local components exactly like
// date.ts's localDateStr — so daysSince (which parses both sides as UTC
// midnight of their local calendar date) returns an exact whole-day count.
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe("daysSince", () => {
  it("is 0 for today", () => {
    expect(daysSince(iso(0))).toBe(0);
  });

  it("counts whole calendar days", () => {
    expect(daysSince(iso(3))).toBe(3);
    expect(daysSince(iso(30))).toBe(30);
  });

  it("is negative for a future date", () => {
    expect(daysSince(iso(-2))).toBe(-2);
  });
});

describe("isStale", () => {
  // Each MetricKind has its own freshness window (maxFreshDays):
  // sync 1, recovery 2, weight 4, bodyComp 10. Fresh at the boundary, stale
  // one day past it.
  it.each([
    ["sync", 1] as const,
    ["recovery", 2] as const,
    ["weight", 4] as const,
    ["bodyComp", 10] as const,
  ])("%s is fresh at the boundary and stale one day past it", (kind, maxFresh) => {
    expect(isStale(kind, iso(maxFresh))).toBe(false);
    expect(isStale(kind, iso(maxFresh + 1))).toBe(true);
  });

  it("treats a fresh reading logged today as not stale", () => {
    expect(isStale("recovery", iso(0))).toBe(false);
  });

  it("treats absent data as not stale (unknown ≠ stale)", () => {
    expect(isStale("recovery", null)).toBe(false);
    expect(isStale("recovery", undefined)).toBe(false);
    expect(isStale("sync", "")).toBe(false);
  });
});

describe("formatAgo", () => {
  it("says today for 0 or future dates", () => {
    expect(formatAgo(iso(0))).toBe("today");
    expect(formatAgo(iso(-1))).toBe("today");
  });

  it("says yesterday for 1 day", () => {
    expect(formatAgo(iso(1))).toBe("yesterday");
  });

  it("counts days below two weeks", () => {
    expect(formatAgo(iso(5))).toBe("5 days ago");
    expect(formatAgo(iso(13))).toBe("13 days ago");
  });

  it("switches to floored weeks at two weeks and beyond", () => {
    expect(formatAgo(iso(14))).toBe("2 weeks ago");
    expect(formatAgo(iso(20))).toBe("2 weeks ago"); // 20/7 → 2
    expect(formatAgo(iso(21))).toBe("3 weeks ago");
  });
});
