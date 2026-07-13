import { useId, useMemo, type CSSProperties, type ReactNode } from "react";

/** clamp to 0…1 */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Tip-light tone for the leading head/cap — the gradient's lightest stop.
 *  Lightens over the first 150° of fill (`k`), maxing out at `maxMix`% white. */
function lapHead(color: string, trim: number, maxMix = 38) {
  const k = Math.min(1, (clamp01(trim) * 360) / 150);
  return `color-mix(in srgb, ${color}, #fff ${Math.round(k * maxMix)}%)`;
}

/** The conic tip-fade the arc's white mask shows through. Angles are measured
 *  from 12 o'clock, clockwise — NO `from` offset, so the gradient's origin
 *  matches the mask arc's own (`rotate(-90)` start). The fill stays the
 *  saturated base colour and only lightens over a window right at the leading
 *  tip (FADE, 55% of the filled arc, clamped 120–200°); the lightest tone is
 *  then held through `capDeg` so the brightest point sits ON the rounded cap
 *  (which overhangs the dash end by stroke/2). Base repeats at 360° so there's
 *  no seam under the start. EVERY lap — including at/over 100% and gold — is a
 *  gradient; the only full-circle seam (lightest tip meeting base at 12 o'clock)
 *  is covered by the overflow lap, which always starts at 12. */
function lapFill(
  color: string,
  trim: number,
  maxMix: number | undefined,
  capDeg: number,
) {
  const tipDeg = clamp01(trim) * 360;
  const FADE = Math.max(120, Math.min(200, tipDeg * 0.55));
  const fadeStart = Math.max(0, tipDeg - FADE);
  const tl = lapHead(color, trim, maxMix);
  const hold = Math.min(359.9, tipDeg + capDeg);
  return `conic-gradient(${color} 0deg, ${color} ${fadeStart}deg, ${tl} ${tipDeg}deg, ${tl} ${hold}deg, ${color} 360deg)`;
}

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
  const clamped = clamp01(pct);
  const offset = circumference * (1 - clamped);
  const maskId = useId();
  // Completion glow — DECOUPLED from the fill. At/over 100% the ring keeps its
  // tip-fade gradient (no colour ever goes solid, gold included) and gains a
  // soft halo tinted to its own colour (`--ring-glow`), so "closed" reads as lit.
  // Box-shadow on the wrapper (`.is-complete`), not an SVG filter — see
  // activityRing.css for why.
  const isComplete = clamped >= 1;
  // The rounded cap overhangs the dash end by stroke/2 — hold the tip tone that
  // extra `capDeg` so the brightest zone lands on the cap, not just before it.
  const capDeg = ((strokeWidth / 2) / r) * (180 / Math.PI);
  const fill = lapFill(color, clamped, undefined, capDeg);
  const wrapStyle: CSSProperties = { width: size, height: size };
  if (isComplete) (wrapStyle as Record<string, string>)["--ring-glow"] = color;

  return (
    <div
      className={`activity-ring${isComplete ? " is-complete" : ""}`}
      style={wrapStyle}
    >
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
              background: fill,
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
  const ribbonMaskId = useId();
  const bandClipId = useId();
  const shadowGradId = useId();
  // Overflow only ever renders past 100%, so it is always "complete": it keeps
  // its own colour and gains the decoupled completion glow (`--ring-glow`) —
  // same box-shadow mechanism as ActivityRing (see activityRing.css for why not
  // an SVG filter).
  const capDeg = ((strokeWidth / 2) / r) * (180 / Math.PI);
  // Tail = the leading end of the second lap; the contact shadow sits here.
  const tailAngle = overflowFrac * 2 * Math.PI - Math.PI / 2;
  const tailX = c + r * Math.cos(tailAngle);
  const tailY = c + r * Math.sin(tailAngle);
  // Annulus matching the ring's own stroke band (outer r+sw/2, inner r−sw/2) as
  // an even-odd path so the inner circle is a hole. Clips the tail shadow to
  // land only ON the ring — never past the outer edge nor into the inner hole.
  const rOut = r + strokeWidth / 2;
  const rIn = r - strokeWidth / 2;
  // Depends only on the ring's fixed geometry (size/strokeWidth), not `ratio` —
  // memoise so the count-up roll doesn't rebuild the same annulus path each frame.
  const bandPath = useMemo(
    () =>
      `M ${c - rOut} ${c} a ${rOut} ${rOut} 0 1 0 ${rOut * 2} 0 a ${rOut} ${rOut} 0 1 0 ${-rOut * 2} 0 Z ` +
      `M ${c - rIn} ${c} a ${rIn} ${rIn} 0 1 0 ${rIn * 2} 0 a ${rIn} ${rIn} 0 1 0 ${-rIn * 2} 0 Z`,
    [c, rOut, rIn],
  );
  // Contact-shadow radius. Clamped to the chord back to the lap's 12-o'clock
  // start so a tiny overflow can't let the blob also darken the START cap
  // ("two shadows" bug). Floor at 0.6×stroke — the ribbon's own rounded cap
  // (radius stroke/2, same centre) would otherwise hide the shadow entirely.
  const startX = c;
  const startY = c - r;
  const chord = Math.hypot(tailX - startX, tailY - startY);
  const shR = Math.max(strokeWidth * 0.6, Math.min(strokeWidth * 0.75, chord * 0.55));
  // The second lap ribbon: same track/radius/colour, filled with a gentler
  // tip-fade (26% max lighten vs 38% below 100%) so its pale tip doesn't read
  // as a break against the base ring it laps onto.
  const ribbonFill = lapFill(color, overflowFrac, 26, capDeg);
  // Base lap = a FULL-circle tip-fade (not a flat stroke), identical to
  // ActivityRing at 100% so the two never disagree. Its one seam — lightest tip
  // meeting base at 12 o'clock — is covered by the second lap, which always
  // starts at 12 (à la Apple hiding the Move-ring seam under the lap's cap).
  const baseMaskId = useId();
  const baseFill = lapFill(color, 1, undefined, capDeg);
  const wrapStyle: CSSProperties = { width: size, height: size };
  (wrapStyle as Record<string, string>)["--ring-glow"] = color;

  return (
    <div className="activity-ring is-complete" style={wrapStyle}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          {/* The ribbon shape = one rounded arc, as a white mask the gradient
             shows through — same technique as the base lap. */}
          <mask id={ribbonMaskId}>
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${overflowLength} ${circumference}`}
              transform={`rotate(-90 ${c} ${c})`}
            />
          </mask>
          {/* Full-circle mask for the base lap's tip-fade fill. */}
          <mask id={baseMaskId}>
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#fff"
              strokeWidth={strokeWidth}
              transform={`rotate(-90 ${c} ${c})`}
            />
          </mask>
          <mask id={bandClipId}>
            <path d={bandPath} clipRule="evenodd" fillRule="evenodd" fill="#fff" />
          </mask>
          {/* Centred radial contact shadow (dark core → transparent). No SVG
             blur filter — iOS Safari drops those; the gradient IS the softness. */}
          <radialGradient id={shadowGradId} gradientUnits="userSpaceOnUse" cx={tailX} cy={tailY} r={shR}>
            <stop offset="0%" stopColor="#000" stopOpacity={1} />
            <stop offset="55%" stopColor="#000" stopOpacity={0.52} />
            <stop offset="100%" stopColor="#000" stopOpacity={0} />
          </radialGradient>
        </defs>
        {/* Draw order: track → base lap (tip-fade) → band-clipped shadow → ribbon. */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        <foreignObject x={0} y={0} width={size} height={size} mask={`url(#${baseMaskId})`}>
          <div style={{ width: "100%", height: "100%", background: baseFill }} />
        </foreignObject>
        {overflowFrac > 0.0006 && (
          <>
            <g mask={`url(#${bandClipId})`}>
              <circle cx={tailX} cy={tailY} r={shR} fill={`url(#${shadowGradId})`} />
            </g>
            <foreignObject x={0} y={0} width={size} height={size} mask={`url(#${ribbonMaskId})`}>
              <div style={{ width: "100%", height: "100%", background: ribbonFill }} />
            </foreignObject>
          </>
        )}
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}
