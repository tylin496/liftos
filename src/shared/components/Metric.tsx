import type { ReactNode } from "react";

/* ── Metric primitives ─────────────────────────────────────────────────────
   One number language for every tab. Composable (not a single config card)
   so each feature keeps its own layout — see "share brain, not layout".

   - MetricValue : the primary number. Bold, ink, mono. `unit` renders inline
                   in the canonical unit style (one step down, medium, ink-3).
   - MetricDelta : a signed change. Caller passes the raw delta + whether
                   higher is better; the component owns sign / abs / colour.
   - MetricCaption: the muted context line ("vs 14 days").
   ──────────────────────────────────────────────────────────────────────── */

export type MetricSize = "xl" | "lg" | "md";

export function MetricValue({
  size = "lg",
  unit,
  tone,
  className,
  children,
}: {
  size?: MetricSize;
  unit?: ReactNode;
  /** Colour the value itself (e.g. retention <85%). Deltas use MetricDelta. */
  tone?: "good" | "bad";
  className?: string;
  children: ReactNode;
}) {
  const cls = [
    "metric-val",
    `metric-val--${size}`,
    tone ? `metric-val--${tone}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {children}
      {unit != null && <span className="metric-unit">{unit}</span>}
    </span>
  );
}

export function MetricDelta({
  value,
  higherBetter,
  decimals = 0,
  unit,
  threshold = 0,
  className,
}: {
  value: number | null | undefined;
  /** Omit → always neutral (grey), e.g. weight pace. Set → up/down map to good/bad. */
  higherBetter?: boolean;
  decimals?: number;
  /** Unit suffix on the delta itself, e.g. "kg/wk" (not the value's unit). */
  unit?: string;
  /** |value| ≤ threshold reads as flat (no good/bad colour). */
  threshold?: number;
  className?: string;
}) {
  if (value == null) return null;

  const isFlat = Math.abs(value) <= threshold;
  const good =
    isFlat || higherBetter == null ? null : higherBetter ? value > 0 : value < 0;
  const toneCls =
    good == null ? "metric-delta--flat" : good ? "metric-delta--good" : "metric-delta--bad";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={["metric-delta", toneCls, className ?? ""].filter(Boolean).join(" ")}>
      {sign}
      {abs}
      {unit ? ` ${unit}` : ""}
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
