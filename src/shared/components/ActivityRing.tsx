import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { clamp01 } from "@shared/lib/num";

/** Tip-light tone for the leading head/cap — the gradient's lightest stop.
 *  Normally lightens over the first 150° of fill (`k`), maxing out at `maxMix`%
 *  white; `fullLight` pins it to the full `maxMix` regardless of arc length, so
 *  a short lap (e.g. a small overflow ribbon) still reaches its palest at the tip. */
function lapHead(color: string, trim: number, maxMix = 38, fullLight = false) {
  const k = fullLight ? 1 : Math.min(1, (clamp01(trim) * 360) / 150);
  return `color-mix(in srgb, ${color}, #fff ${Math.round(k * maxMix)}%)`;
}

/** The conic tip-fade the arc's white mask shows through. Angles are measured
 *  from 12 o'clock, clockwise — NO `from` offset, so the gradient's origin
 *  matches the mask arc's own (`rotate(-90)` start). The fill stays the
 *  saturated base colour and only lightens over a window right at the leading
 *  tip (FADE, 55% of the filled arc, clamped 120–200°); the lightest tone is
 *  then held through `capDeg` so the brightest point sits ON the rounded cap
 *  (which overhangs the dash end by stroke/2). Used only BELOW 100%, where the
 *  arc doesn't close, so the bright tip never meets the base start — no seam.
 *  At/over 100% use `lapFull` instead (a closed tip-fade would hard-step at 12). */
function lapFill(
  color: string,
  trim: number,
  maxMix: number | undefined,
  capDeg: number,
  fullLight = false,
) {
  const tipDeg = clamp01(trim) * 360;
  const FADE = Math.max(120, Math.min(200, tipDeg * 0.55));
  const fadeStart = Math.max(0, tipDeg - FADE);
  const tl = lapHead(color, trim, maxMix, fullLight);
  const hold = Math.min(359.9, tipDeg + capDeg);
  return `conic-gradient(${color} 0deg, ${color} ${fadeStart}deg, ${tl} ${tipDeg}deg, ${tl} ${hold}deg, ${color} 360deg)`;
}

/** Seam-free sheen for a CLOSED (≥100%) lap. A tip-fade can't close without a
 *  hard step where its bright tip meets its base start at 12 o'clock, so instead
 *  the full circle is base colour at 12 (0°=360°, identically — no seam, and it
 *  blends with the overflow lap's base-colour start) and brightens symmetrically
 *  to a soft peak at the bottom (180°). Kept subtle so it never out-brightens
 *  the leading tip — that stays the ring's lightest point. Still a gradient,
 *  never solid. */
function lapFull(color: string, maxMix = 16) {
  const peak = `color-mix(in srgb, ${color}, #fff ${maxMix}%)`;
  return `conic-gradient(${color} 0deg, ${peak} 180deg, ${color} 360deg)`;
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
  // Below 100% the arc is open → tip-fade; at exactly 100% it closes → seam-free
  // full sheen (matching OverflowRing's base lap so the crossover doesn't pop).
  const fill = isComplete ? lapFull(color) : lapFill(color, clamped, undefined, capDeg);
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
  // Contact shadow: single-sided, cast AHEAD of the tip only. A blob centred on
  // the tip rings the rounded cap with shadow on every side, which reads as a
  // ball floating above the ring; instead the blob's centre is pushed forward
  // along the direction of travel exactly far enough that the cap (radius
  // stroke/2) hides everything behind it — what remains is a crescent on the
  // base lap in front of the tip, like the cast shadow on Apple's activity
  // rings. One-sided, it can run at full strength from the first overlap
  // without the floating look, and it can never reach back to darken the
  // 12-o'clock start cap.
  // 0.75×stroke radius, centred ½ stroke ahead of the tip — the gradient's core
  // sits exactly on the cap's front edge: darkest right at the contact line,
  // fading out over the ¾ stroke beyond it; the rear stays hidden under the
  // cap. (Tuned by eye across several rounds: the same radius rear-pinned read
  // as a diffuse glow patch, smaller radii as a barely-there sliver.)
  const shR = strokeWidth * 0.75;
  const shOff = strokeWidth * 0.5;
  const shX = tailX + -Math.sin(tailAngle) * shOff;
  const shY = tailY + Math.cos(tailAngle) * shOff;
  // Base lap + ribbon are ONE continuous comet that brightens ALONG the stroke
  // toward the leading tip (not a symmetric top/bottom sheen, which reads as a
  // vertical gradient). Think of a single spiral of length `spiralDeg`, dark at
  // the 12-o'clock start, lightening to its palest at the tip. The last `FADE`
  // degrees before the tip carry the brightening; everything earlier stays base
  // colour. The base lap shows spiral 0–360°, the ribbon shows 360°→tip — so the
  // base's bright end (just left of 12) and the ribbon's start (just right of 12)
  // meet at the SAME brightness `handoff`, flowing through 12 with no seam.
  const TIP_MIX = 40; // palest tone at the very tip
  const spiralDeg = (1 + overflowFrac) * 360;
  const FADE = Math.min(200, spiralDeg); // length of the bright leading window
  const fadeStartSpiral = spiralDeg - FADE;
  // fraction (0→1) toward the tip tone at a given spiral angle
  const litFrac = (s: number) => Math.max(0, Math.min(1, (s - fadeStartSpiral) / FADE));
  const mixAt = (s: number) =>
    `color-mix(in srgb, ${color}, #fff ${Math.round(litFrac(s) * TIP_MIX)}%)`;
  const peak = `color-mix(in srgb, ${color}, #fff ${TIP_MIX}%)`;
  const overflowAngle = overflowFrac * 360;
  const hold = Math.min(359.9, overflowAngle + capDeg);
  // Brightness the base hands to the ribbon at 12 (spiral 360°).
  const handoff = mixAt(360);
  const baseMaskId = useId();
  // The comet's dark TAIL is tucked a few degrees INTO the ribbon-covered arc
  // (`tailDip`), so the base lap is `handoff` at BOTH 0° and 360° — i.e. no step
  // at the 0/360 junction (12 o'clock), which otherwise sat exactly at the
  // ribbon's start edge and peeked past its rounded cap. From `handoff` at 12 it
  // dips to base colour under the ribbon, holds, then ramps back to `handoff` at
  // 360° to hand off to the ribbon's start. Large overflow (fade never reaches
  // the base lap) → the whole base is just base colour and the ribbon is the comet.
  const tailDip = Math.min(overflowAngle * 0.5, 30);
  const baseFill =
    fadeStartSpiral >= 360
      ? color
      : `conic-gradient(${handoff} 0deg, ${color} ${tailDip}deg, ${color} ${fadeStartSpiral}deg, ${handoff} 360deg)`;
  // Ribbon: continues from `handoff` (or base colour, if the fade opens mid-ribbon)
  // up to the palest tip, held through the rounded cap.
  const ribbonFadeStart = fadeStartSpiral - 360;
  const ribbonStops =
    ribbonFadeStart > 0
      ? `${color} 0deg, ${color} ${ribbonFadeStart}deg, ${peak} ${overflowAngle}deg`
      : `${handoff} 0deg, ${peak} ${overflowAngle}deg`;
  // Close on `handoff`, NOT base colour: the rounded START cap extends a few
  // degrees counter-clockwise (samples ~355–360°), so this tail is what paints
  // it. Matching it to `handoff` makes the cap blend into the base lap at 12
  // o'clock instead of showing as a dark notch.
  const ribbonFill = `conic-gradient(${ribbonStops}, ${peak} ${hold}deg, ${handoff} 360deg)`;
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
          <radialGradient id={shadowGradId} gradientUnits="userSpaceOnUse" cx={shX} cy={shY} r={shR}>
            <stop offset="0%" stopColor="#000" stopOpacity={0.82} />
            <stop offset="60%" stopColor="#000" stopOpacity={0.52} />
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
              <circle cx={shX} cy={shY} r={shR} fill={`url(#${shadowGradId})`} />
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
