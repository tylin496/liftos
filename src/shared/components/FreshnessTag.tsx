import { isStale, formatAgo, daysSince, type MetricKind } from "@shared/lib/freshness";
import "./freshnessTag.css";

/**
 * The single, consistent data-recency indicator — sits in a card's top-right
 * corner and reports how fresh THAT card's data is. Quiet by default (the
 * last sync's clock time); escalates to a relative "N days ago" warn-toned
 * hint once the reading is past its metric's freshness window (see
 * freshness.ts). The clock ignores which calendar day the data itself is
 * dated — nightly syncs write recovery fields (sleep/RHR/HRV/resting energy)
 * onto a *yesterday*-dated row by design, so under normal daily use `date`
 * is basically always "yesterday" and a day-relative label there would carry
 * no signal. Sync recency, not data-date, is what's worth showing while fresh.
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

  let text: string;
  let isClock = false; // a bare HH:MM reading — wear the app's mono number face
  if (validSyncedAt && !stale) {
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
