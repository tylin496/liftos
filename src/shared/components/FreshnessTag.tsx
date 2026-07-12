import { isStale, formatAgo, daysSince, type MetricKind } from "@shared/lib/freshness";
import { localDateStr } from "@shared/lib/date";
import "./freshnessTag.css";

/**
 * The single, consistent data-recency indicator — sits in a card's top-right
 * corner and reports when THAT field was last read. One rule for every metric:
 * synced today → show the clock time it came in (HH:MM); otherwise show how long
 * ago that last reading was ("Yesterday" / "N days ago"), warn-toned once past
 * the metric's freshness window (see freshness.ts).
 *
 * The clock follows the SYNC write, not the reading's own calendar day: as long
 * as the field isn't stale and the row was written today, we show today's sync
 * time — even when the reading's metric_date is a few days back. Caveat:
 * `health_metrics` is one row per date sharing ONE `updated_at`, so a nightly
 * write onto a row that also holds an older weight surfaces that weight as
 * "synced today" too. That borrowed-freshness trade-off is an accepted owner
 * decision (2026-07-13): favour a live-feeling recency signal over strict
 * per-field honesty, which the frozen 1-row-per-day schema can't provide anyway.
 *
 * Renders nothing when there's no reading at all — the card owns its own empty
 * state, and "no data" must never read as "stale" (see [[data-freshness-model]]).
 */
export function FreshnessTag({
  date,
  kind,
  updatedAt,
}: {
  date: string | null | undefined;
  kind: MetricKind;
  /** ISO sync-write timestamp — shown as a clock (HH:MM) while the reading is
   *  fresh, regardless of `date`'s calendar day. */
  updatedAt?: string | null;
}) {
  if (!date) return null;
  const stale = isStale(kind, date);
  const days = daysSince(date);

  const syncedAt = updatedAt ? new Date(updatedAt) : null;
  const validSyncedAt = syncedAt && !Number.isNaN(syncedAt.getTime());

  // Show the clock whenever the field is fresh AND the row was synced today —
  // the sync write, not the reading's metric_date, is the recency signal (owner
  // decision 2026-07-13; see header for the shared-row borrowed-freshness caveat).
  // This also subsumes recovery (sleep/HRV/RHR), whose reading lands on the prior
  // day's row via the nightly sync and so is never dated "today": a metric_date
  // gate would perpetually read it as "Yesterday" minutes after it arrived.
  const syncedToday = validSyncedAt && localDateStr(syncedAt) === localDateStr();
  const showClock = validSyncedAt && !stale && syncedToday;

  let text: string;
  let isClock = false; // a bare HH:MM reading — wear the app's mono number face
  if (showClock) {
    text = `${String(syncedAt.getHours()).padStart(2, "0")}:${String(syncedAt.getMinutes()).padStart(2, "0")}`;
    isClock = true;
  } else if (days <= 0) {
    text = "Today";
  } else {
    const rel = formatAgo(date); // "yesterday" / "3 days ago" / "2 weeks ago"
    text = rel.charAt(0).toUpperCase() + rel.slice(1);
  }

  return (
    <span className={`freshness-tag${isClock ? " is-clock" : ""}${stale ? " is-stale" : ""}`}>
      {text}
    </span>
  );
}
