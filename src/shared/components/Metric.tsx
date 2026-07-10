import type { CSSProperties, ReactNode } from "react";

/* ── Metric primitives ─────────────────────────────────────────────────────
   One number language for every tab. Composable (not a single config card)
   so each feature keeps its own layout — see "share brain, not layout".

   - MetricValue : the primary number. Bold, ink, mono. `unit` renders inline
                   in the canonical unit style (one step down, medium, ink-3).
   - MetricDelta : a signed change. Caller passes the raw delta + whether
                   higher is better; the component owns sign / abs / colour.
   - MetricCaption: the muted context line ("vs 14 days").
   ──────────────────────────────────────────────────────────────────────── */

export type MetricSize = "xl" | "lg" | "sm" | "md";

export function MetricValue({
  size = "lg",
  unit,
  className,
  style,
  children,
}: {
  size?: MetricSize;
  unit?: ReactNode;
  className?: string;
  /** Fixed identity colour for the handful of metrics that own one (Calories,
      Protein, Weight, Body Fat, Lean Mass). Every other value stays --ink —
      no tone-by-state coloring. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cls = ["metric-val", `metric-val--${size}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} style={style}>
      {children}
      {unit != null && <span className="metric-unit">{unit}</span>}
    </span>
  );
}

/** A signed change, rendered ONLY when the app can judge it good/bad — see the
   "metric colour system" rule. Pure renderer: it does not decide polarity, the
   caller passes an already-resolved `direction`.

   Two invariants live here:
   - arrow ⟺ colour: a signed delta always carries a good/bad colour, never grey.
   - no colour → no delta: omit `direction` (metric isn't judgeable) or land
     within `threshold` (change is noise) → render NOTHING, not a grey chip. */
export function MetricDelta({
  value,
  direction,
  decimals = 0,
  unit,
  threshold = 0,
  arrowOnly = false,
  className,
}: {
  value: number | null | undefined;
  /** Resolved good direction. Omit → metric has no objective good/bad → not
      rendered (never a neutral grey delta). */
  direction?: "up-good" | "down-good";
  decimals?: number;
  /** Unit suffix on the delta itself, e.g. "kg/wk" (not the value's unit). */
  unit?: string;
  /** Optional wider noise band: |value| ≤ threshold → treated as flat. Beyond
      this, anything that rounds to zero at `decimals` is already flat. */
  threshold?: number;
  /** Show only the coloured up/down arrow, no magnitude — direction as a glyph,
      for when the number already lives next to it (e.g. a signed rate value). */
  arrowOnly?: boolean;
  className?: string;
}) {
  if (value == null || direction == null) return null;
  // "Flat" is never a delta. A change that rounds to zero at display precision
  // (or lands inside an explicit wider noise band) isn't a move → render
  // NOTHING: no signed zero, no grey chip. Flatness that actually *means*
  // something (e.g. a cut stalling) is a verdict — it belongs to pace/status.
  const abs = Math.abs(value);
  const rounded = Number(abs.toFixed(decimals));
  if (rounded === 0 || abs <= threshold) return null;

  const good = direction === "up-good" ? value > 0 : value < 0;
  const toneCls = good ? "metric-delta--good" : "metric-delta--bad";
  // Arrow direction is driven by the value's sign, independent of tone colour
  // — a declining "good" metric (e.g. body fat) shows a green down arrow.
  const arrow = value > 0 ? "▲" : "▼";
  const absStr = rounded.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={["metric-delta", toneCls, className ?? ""].filter(Boolean).join(" ")}>
      {arrow}
      {!arrowOnly && (
        <>
          {" "}
          {absStr}
          {/* "%" is a tight suffix (8%); worded units get a space (8 kg/wk). */}
          {unit ? (unit === "%" ? unit : ` ${unit}`) : ""}
        </>
      )}
    </span>
  );
}

export function MetricCaption({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={["metric-caption", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
