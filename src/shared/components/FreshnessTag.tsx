import { isStale, formatAgo, daysSince, type MetricKind } from "@shared/lib/freshness";
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
  /** ISO sync-write timestamp — shows a clock (HH:MM) for a same-day reading. */
  updatedAt?: string | null;
}) {
  if (!date) return null;
  const stale = isStale(kind, date);
  const days = daysSince(date);

  let text: string;
  let isClock = false; // a bare HH:MM reading — wear the app's mono number face
  if (days <= 0 && updatedAt) {
    const t = new Date(updatedAt);
    if (Number.isNaN(t.getTime())) {
      text = "Today";
    } else {
      text = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      isClock = true;
    }
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
