import { describe, it, expect } from "vitest";
import { localDateStr, localDateStrDaysAgo, timelineDate } from "./date";

// Build a local-calendar YYYY-MM-DD the same way date.ts does, so assertions
// stay timezone-independent (all math is in local components, never UTC).
const pad = (n: number) => String(n).padStart(2, "0");
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

describe("localDateStr", () => {
  it("formats a given date as local YYYY-MM-DD with zero-padding", () => {
    // Month is 0-indexed in the Date constructor: 0 → January.
    expect(localDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateStr(new Date(2025, 11, 25))).toBe("2025-12-25");
  });

  it("pads single-digit months and days", () => {
    expect(localDateStr(new Date(2026, 8, 9))).toBe("2026-09-09");
  });

  it("defaults to today when no date is passed", () => {
    expect(localDateStr()).toBe(localIso(new Date()));
  });
});

describe("localDateStrDaysAgo", () => {
  it("returns today for 0 days", () => {
    expect(localDateStrDaysAgo(0)).toBe(localDateStr());
  });

  it("subtracts whole days across a month boundary", () => {
    const d = new Date();
    d.setDate(d.getDate() - 40);
    expect(localDateStrDaysAgo(40)).toBe(localIso(d));
  });
});

describe("timelineDate", () => {
  it("splits an ISO date into month abbreviation, padded day, and year", () => {
    expect(timelineDate("2025-06-25")).toEqual({ mon: "JUN", day: "25", year: 2025 });
  });

  it("pads single-digit days", () => {
    expect(timelineDate("2026-01-03")).toEqual({ mon: "JAN", day: "03", year: 2026 });
  });

  it("parses at local noon so no timezone shifts the calendar day", () => {
    // "T12:00:00" anchoring means even far-from-UTC zones keep the same day.
    expect(timelineDate("2026-12-31")).toEqual({ mon: "DEC", day: "31", year: 2026 });
  });

  it("returns empty fields for an empty string", () => {
    expect(timelineDate("")).toEqual({ mon: "", day: "", year: null });
  });

  it("echoes an unparseable string in day and nulls the year", () => {
    expect(timelineDate("not-a-date")).toEqual({ mon: "", day: "not-a-date", year: null });
  });
});
