import { describe, it, expect } from "vitest";
import {
  fmtTopbarDate, shiftISODays, fmtWeekRange, fmtDayLabel,
  diffDays, daysSince, fmt1kg, greetingName, greeting,
} from "./format";

// Local dates constructed with (y, monthIndex, day, hour) so getDay/getHours
// read in the test runner's zone — the same zone the helpers use.

describe("fmtTopbarDate", () => {
  it("renders WEEKDAY, MON DAY in upper-case", () => {
    // 2026-07-14 is a Tuesday.
    expect(fmtTopbarDate(new Date(2026, 6, 14, 9))).toBe("TUE, JUL 14");
  });
  it("uses local getDay/getMonth (Jan 1)", () => {
    expect(fmtTopbarDate(new Date(2026, 0, 1, 9))).toBe("THU, JAN 1");
  });
});

describe("shiftISODays", () => {
  it("adds whole days", () => {
    expect(shiftISODays("2026-07-14", 3)).toBe("2026-07-17");
  });
  it("subtracts whole days", () => {
    expect(shiftISODays("2026-07-14", -1)).toBe("2026-07-13");
  });
  it("rolls across a month boundary", () => {
    expect(shiftISODays("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftISODays("2026-08-01", -1)).toBe("2026-07-31");
  });
  it("rolls across a year boundary", () => {
    expect(shiftISODays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("+7 lands on the same weekday one week later", () => {
    expect(shiftISODays("2026-03-08", 7)).toBe("2026-03-15"); // spans US DST change
  });
});

describe("fmtWeekRange", () => {
  it("same-month week collapses the second month name", () => {
    expect(fmtWeekRange("2026-07-06")).toBe("Jul 6 – 12");
  });
  it("cross-month week names both months", () => {
    // Mon Jun 29 → Sun Jul 5
    expect(fmtWeekRange("2026-06-29")).toBe("Jun 29 – Jul 5");
  });
});

describe("fmtDayLabel", () => {
  it("renders 'Wkd, Mon Day'", () => {
    expect(fmtDayLabel("2026-07-14")).toBe("Tue, Jul 14");
  });
});

describe("diffDays", () => {
  it("is b − a in whole days", () => {
    expect(diffDays("2026-07-01", "2026-07-08")).toBe(7);
  });
  it("is negative when b precedes a", () => {
    expect(diffDays("2026-07-08", "2026-07-01")).toBe(-7);
  });
  it("is zero for the same day", () => {
    expect(diffDays("2026-07-14", "2026-07-14")).toBe(0);
  });
});

describe("daysSince", () => {
  it("rounds elapsed whole days from an injected now", () => {
    const now = new Date(2026, 6, 14, 12).getTime();
    expect(daysSince("2026-07-04", now)).toBe(10);
  });
  it("is 0 for today", () => {
    const now = new Date(2026, 6, 14, 18).getTime();
    expect(daysSince("2026-07-14", now)).toBe(0);
  });
});

describe("fmt1kg", () => {
  it("always shows exactly one decimal", () => {
    expect(fmt1kg(91)).toBe("91.0");
    expect(fmt1kg(91.72)).toBe("91.7");
  });
});

describe("greetingName", () => {
  it("prefers the whitelist override", () => {
    expect(greetingName({ email: "sam@example.com", user_metadata: { full_name: "Sam Rivera" } }, "Thomas")).toBe("Thomas");
  });
  it("falls back to the OAuth full name's first token", () => {
    expect(greetingName({ email: "sam@example.com", user_metadata: { full_name: "Sam Rivera" } })).toBe("Sam");
  });
  it("falls back to the email local-part", () => {
    expect(greetingName({ email: "sam@example.com" })).toBe("sam");
  });
  it("falls back to 'there' with no user", () => {
    expect(greetingName(null)).toBe("there");
    expect(greetingName(undefined)).toBe("there");
  });
});

describe("greeting", () => {
  const u = { email: "sam@example.com" };
  it("says 'Still up' overnight (< 5am)", () => {
    expect(greeting(u, undefined, new Date(2026, 6, 14, 3))).toBe("Still up, sam");
  });
  it("morning before noon", () => {
    expect(greeting(u, undefined, new Date(2026, 6, 14, 9))).toBe("Good morning, sam");
  });
  it("afternoon 12–17", () => {
    expect(greeting(u, undefined, new Date(2026, 6, 14, 14))).toBe("Good afternoon, sam");
  });
  it("evening 18+", () => {
    expect(greeting(u, undefined, new Date(2026, 6, 14, 20))).toBe("Good evening, sam");
  });
  it("uses the override name when present", () => {
    expect(greeting(u, "Thomas", new Date(2026, 6, 14, 9))).toBe("Good morning, Thomas");
  });
});
