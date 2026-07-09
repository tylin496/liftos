import { isStale, formatAgo, daysSince, type MetricKind } from "@shared/lib/freshness";
import { localDateStr } from "@shared/lib/date";
import "./freshnessTag.css";

/**
 * The single, consistent data-recency indicator — sits in a card's top-right
 * corner and reports how fresh THAT card's data is. Quiet by default (a sync
 * time for today, or a relative "N days ago"); escalates to a warn-toned hint
 * once the reading is past its metric's freshness window (see freshness.ts).
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
  /** ISO sync-write timestamp — shows a clock (HH:MM) whenever the sync itself
   *  happened today, even if the reading's data-date (`date`) is yesterday
   *  (nightly syncs write recovery fields onto a yesterday-dated row). */
  updatedAt?: string | null;
}) {
  if (!date) return null;
  const stale = isStale(kind, date);
  const days = daysSince(date);

  let text: string;
  let isClock = false; // a bare HH:MM reading — wear the app's mono number face
  const syncedAt = updatedAt ? new Date(updatedAt) : null;
  const syncedToday =
    syncedAt && !Number.isNaN(syncedAt.getTime()) && localDateStr(syncedAt) === localDateStr();

  if (syncedAt && syncedToday) {
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
