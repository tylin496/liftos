import { useId, type ReactNode } from "react";

/** A single progress ring — stroke-based, so it scales cleanly from the
 *  topbar avatar size up to a hero card. `pct` is 0–1+ (values over 1 just
 *  clamp the stroke, they don't wrap). */
export function ActivityRing({
  pct,
  size,
  strokeWidth,
  color,
  children,
  transition = "stroke-dashoffset 400ms ease, stroke 400ms ease",
}: {
  pct: number;
  size: number;
  strokeWidth: number;
  color: string;
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
  const maskId = useId();
  // The fill lightens along the arc via a conic gradient (varies by angle, unlike
  // a linear gradient which fades along a straight chord). The ramp is FIXED base
  // 0° → light 360°, so the tail always stays the saturated base colour and the
  // tip's paleness scales with fill — a small fill reads as saturated base (not
  // washed out), only a near-full ring reaches the palest tint at its tip. The arc
  // shape (rounded caps + dashoffset fill/animation) is a white mask the gradient
  // shows through.
  const light = `color-mix(in srgb, ${color}, white 55%)`;

  return (
    <div className="activity-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <mask id={maskId}>
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${c} ${c})`}
              style={{ transition }}
            />
          </mask>
        </defs>
        {/* Track = neutral grey, independent of the fill colour. */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        <foreignObject x={0} y={0} width={size} height={size} mask={`url(#${maskId})`}>
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `conic-gradient(from -90deg, ${color} 0deg, ${light} 360deg)`,
            }}
          />
        </foreignObject>
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}

/** Past 100%, draw a second lap layered on the same track/radius instead of
 *  re-coloring or nesting a smaller ring — reads as "stacked on top", not a
 *  state change. Use in place of `ActivityRing` wherever `pct` can exceed 1. */
export function OverflowRing({
  ratio,
  size,
  strokeWidth,
  color,
  children,
}: {
  ratio: number;
  size: number;
  strokeWidth: number;
  color: string;
  children?: ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const overflowFrac = Math.min(1, ratio - 1);
  const overflowLength = overflowFrac * circumference;
  const tailClipId = useId();
  const bandClipId = useId();
  // Tail = the leading end of the second lap; the shadow is revealed only here.
  const tailAngle = overflowFrac * 2 * Math.PI - Math.PI / 2;
  const tailX = c + r * Math.cos(tailAngle);
  const tailY = c + r * Math.sin(tailAngle);
  // Annulus matching the ring's own stroke band (outer r+sw/2, inner r−sw/2) as
  // an even-odd path so the inner circle is a hole. Clips the tail shadow to
  // land only ON the ring — never past the outer edge nor into the inner hole.
  const rOut = r + strokeWidth / 2;
  const rIn = r - strokeWidth / 2;
  const bandPath =
    `M ${c - rOut} ${c} a ${rOut} ${rOut} 0 1 0 ${rOut * 2} 0 a ${rOut} ${rOut} 0 1 0 ${-rOut * 2} 0 Z ` +
    `M ${c - rIn} ${c} a ${rIn} ${rIn} 0 1 0 ${rIn * 2} 0 a ${rIn} ${rIn} 0 1 0 ${-rIn * 2} 0 Z`;
  // The second lap is ONE arc, drawn twice from the same props: the plain ribbon
  // on top, and a shadowed copy behind it shown only where the tail window AND
  // the ring band overlap — so the shadow lifts the ribbon's END, cast onto the
  // ring beneath, while the head continues seamlessly onto the first lap.
  const overflowArc = {
    cx: c, cy: c, r,
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeDasharray: `${overflowLength} ${circumference}`,
    transform: `rotate(-90 ${c} ${c})`,
  };
  return (
    <div className="activity-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <clipPath id={tailClipId}>
            <circle cx={tailX} cy={tailY} r={strokeWidth * 1.6} />
          </clipPath>
          <clipPath id={bandClipId}>
            <path d={bandPath} clipRule="evenodd" fillRule="evenodd" />
          </clipPath>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />
        {overflowFrac > 0 && (
          <g clipPath={`url(#${tailClipId})`}>
            <g clipPath={`url(#${bandClipId})`}>
              <circle {...overflowArc} style={{ filter: "drop-shadow(0 2.5px 3.5px rgba(0,0,0,.7))" }} />
            </g>
          </g>
        )}
        <circle {...overflowArc} />
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}
