// Pure date / label formatters for the Overview cards. Extracted from page.tsx
// so the formatting rules are covered by unit tests rather than living inline in
// the render tree. The two "now"-dependent helpers take an injectable clock so
// they stay deterministic under test; production call sites pass nothing and get
// the live clock, exactly as before.
import { localDateStr } from "@shared/lib/date";

export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
export const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Top-bar eyebrow, e.g. "MON, JUL 14". */
export function fmtTopbarDate(now: Date = new Date()): string {
  return `${WEEKDAY_ABBR[now.getDay()]}, ${MONTH_ABBR[now.getMonth()]} ${now.getDate()}`.toUpperCase();
}

/** Shift an ISO date by whole days (noon-anchored so DST never rolls the day). */
export function shiftISODays(iso: string, days: number): string {
  return localDateStr(new Date(new Date(`${iso}T12:00:00`).getTime() + days * 86400000));
}

/** "Jul 1 – 7" / "Jun 30 – Jul 6" for the Mon→Sun week starting at mondayISO. */
export function fmtWeekRange(mondayISO: string): string {
  const mon = new Date(`${mondayISO}T12:00:00`);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const m1 = MONTH_ABBR[mon.getMonth()];
  const m2 = MONTH_ABBR[sun.getMonth()];
  return m1 === m2
    ? `${m1} ${mon.getDate()} – ${sun.getDate()}`
    : `${m1} ${mon.getDate()} – ${m2} ${sun.getDate()}`;
}

/** Single-day long label, e.g. "Mon, Jul 14" — the week strip's past-day status. */
export function fmtDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAY_ABBR[d.getDay()]}, ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

/** Whole days between two ISO dates (b − a); fractional-safe, noon-anchored. */
export function diffDays(a: string, b: string): number {
  return (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000;
}

/** Whole days from an ISO date until now (rounded). */
export function daysSince(isoDate: string, now: number = Date.now()): number {
  const start = new Date(isoDate + "T12:00:00");
  return Math.round((now - start.getTime()) / 86400000);
}

/** One-decimal kg, e.g. "91.7" — the "Now" footer + hero fallback readout. */
export function fmt1kg(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** The minimal shape greeting() reads off the session user. Structural so the
 *  helper stays decoupled from Supabase's User type (and trivially testable). */
type GreetUser = { email?: string | null; user_metadata?: { full_name?: unknown } } | null | undefined;

/** First name for the greeting: whitelist display name → OAuth full name →
 *  email local-part → "there". `override` is the whitelist lookup result
 *  (displayNameFor), passed in so this module stays decoupled from the
 *  Supabase-touching owner/auth layer and testable in a bare node env. */
export function greetingName(user: GreetUser, override?: string): string {
  return (
    override ??
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "there"
  );
}

/** Time-of-day greeting; "Still up" overnight, "Good morning/…" otherwise. */
export function greeting(user: GreetUser, override?: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const time =
    hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name = greetingName(user, override);
  return time === "night" ? `Still up, ${name}` : `Good ${time}, ${name}`;
}
