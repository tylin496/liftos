import { isStale, formatAgo, daysSince, type MetricKind } from "@shared/lib/freshness";
import "./freshnessTag.css";

/**
 * The single, consistent data-recency indicator — sits in a card's top-right
 * corner and reports when THAT field was last actually read. One rule for every
 * metric: the reading is from today → show the clock time it came in (HH:MM);
 * otherwise show how long ago that last reading was ("Yesterday" / "N days
 * ago"), warn-toned once past the metric's freshness window (see freshness.ts).
 *
 * Why gate the clock on today rather than "while fresh": `health_metrics` is one
 * row per date with all 9 fields sharing ONE `updated_at`, so a nightly recovery
 * write onto a row that also holds an old weight bumps that weight's `updated_at`
 * to "now" — a clock shown off a non-today reading would falsely read as "just
 * synced". `date` (the reading's own metric_date) is the only honest recency
 * signal, so the clock only stands in for it when they're the same day.
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

  // Clock only stands in for a today reading — the shared-row `updated_at` is
  // trustworthy as "when this field came in" only when the reading is actually
  // from today (see header). Older readings show their relative day off `date`.
  const showClock = validSyncedAt && !stale && days <= 0;

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
