import { localDateStr } from "@shared/lib/date";

/**
 * Data freshness — single source of truth for "how old is a reading, and is it
 * stale?" (audit 2026-07-09). Before this, four features each reinvented
 * "how old is this", with different math (round vs floor) and different cutoffs.
 *
 * Table-lookup API on purpose: callers name the metric KIND, never a raw day
 * count. Each metric group has its own expected logging rhythm, so "stale" means
 * "older than that rhythm tolerates" — NOT one global cutoff. A single cutoff
 * would either false-alarm on weight (logged every few days) or let week-old
 * recovery data slip into the Decision Engine.
 */
export type MetricKind = "sync" | "recovery" | "weight" | "bodyComp";

/**
 * maxFreshDays = the largest whole-day age still treated as current.
 * stale ⇔ daysSince(reading) > maxFreshDays[kind].
 *
 *   sync      1  — pipeline / active energy. Expected daily; missing yesterday
 *                  (≥2 days old) means the feed stalled. Locked: pipeline health.
 *   recovery  2  — HRV / sleep / RHR. Nightly. Tolerate one missed night; two
 *                  missed nights (≥3 days) drops it. LOCKED: this is the line the
 *                  Decision Engine gates on so it never acts on stale recovery —
 *                  the one genuinely trust-critical threshold in this audit.
 *   weight    4  — people weigh every 2–3 days; a >4-day gap is a real lapse.
 *                  Pure UX safety net: never fires if you log daily.
 *   bodyComp  10 — BIA body-fat / lean mass. Weekly and noisy; <7 would
 *                  false-alarm. Pure UX safety net.
 */
const MAX_FRESH_DAYS: Record<MetricKind, number> = {
  sync: 1,
  recovery: 2,
  weight: 4,
  bodyComp: 10,
};

type Freshness = "fresh" | "stale" | "absent";

/** Whole calendar days between an ISO date (YYYY-MM-DD) and today, computed the
 *  same way everywhere so boundaries never disagree. Both sides parse as UTC
 *  midnight, so the diff is an exact day count independent of time-of-day. */
export function daysSince(isoDate: string): number {
  return Math.round((Date.parse(localDateStr()) - Date.parse(isoDate)) / 86_400_000);
}

/** Freshness verdict for a metric's latest reading date. A missing date →
 *  "absent" (no reading at all): callers MUST treat this as unknown, never as a
 *  problem — no data ≠ bad news. Only a present-but-old reading is "stale". */
function freshnessOf(kind: MetricKind, isoDate: string | null | undefined): Freshness {
  if (!isoDate) return "absent";
  return daysSince(isoDate) > MAX_FRESH_DAYS[kind] ? "stale" : "fresh";
}

/** True only when a reading exists AND is past its kind's freshness window.
 *  Absent data returns false (unknown ≠ stale). */
export function isStale(kind: MetricKind, isoDate: string | null | undefined): boolean {
  return freshnessOf(kind, isoDate) === "stale";
}

/** Human "x ago" label: today / yesterday / N days ago / N weeks ago. */
export function formatAgo(isoDate: string): string {
  const d = daysSince(isoDate);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return `${Math.floor(d / 7)} weeks ago`;
}
