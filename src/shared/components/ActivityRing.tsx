import type { ReactNode } from "react";

/** A single progress ring — stroke-based, so it scales cleanly from the
 *  topbar avatar size up to a hero card. `pct` is 0–1+ (values over 1 just
 *  clamp the stroke, they don't wrap). */
export function ActivityRing({
  pct,
  size,
  strokeWidth,
  color,
  trackColor = "var(--bg-soft)",
  children,
  transition = "stroke-dashoffset 400ms ease, stroke 400ms ease",
}: {
  pct: number;
  size: number;
  strokeWidth: number;
  color: string;
  trackColor?: string;
  children?: ReactNode;
  /** Override the stroke transition. Pass "none" when `pct` is already being
   *  driven frame-by-frame (e.g. by a count-up) so the ring tracks it exactly
   *  instead of chasing it through its own 400ms ease. */
  transition?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const offset = circumference * (1 - clamped);

  return (
    <div className="activity-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ transition }}
        />
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}
