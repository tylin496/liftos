// The single source of truth for the CONTINUOUS progress-indicator colour:
// every "how far toward a goal" element (Cut Progress bar, Active Target ring,
// top-bar ring) shades along ONE warm→cool ramp by its fill ratio — warm
// orange-red (--progress-start, "not much yet") crossing cyan (--progress-mid) to blue
// (--progress-end) = "almost full." It avoids green (--good's verdict), so
// progress can never be mistaken for a good/bad judgement, and it avoids ember
// (--accent, brand-only) as a solid stop.
//
// COMPLETION is a SEPARATE, DISCRETE state — not part of this ramp. At exactly
// 100% an indicator flips to --progress-complete (gold) as a one-off
// celebration; gold has no range, it only ever means "done." That flip lives
// in the component/CSS (e.g. .goal.is-complete), never in these stops.
//
// The --progress-* tokens are a self-contained set (see tokens.css), decoupled
// from both the brand accent AND the semantic good/bad/gold palette — so this
// ramp and the judgement system can each be re-themed independently.
//
// PROGRESS_STOPS is shared by two renderers:
//  • a linear-gradient (the bar) reveals the whole spectrum along the track;
//  • progressColor(ratio) samples a single point (a ring's one arc colour).
// Both consume the same stops, so the bar's leading edge and a ring at the
// same % are the same colour.

/** [ratio 0–1, CSS colour] stops for the continuous warm→blue ramp. Colours
 *  are --progress-* tokens so they track theme changes; never hardcode hex
 *  here. Gold (completion) is intentionally NOT here — it is a discrete 100%
 *  state. Cyan sits at the midpoint so blue only takes over in the top half
 *  ("almost full"), keeping the low end warm. */
export const PROGRESS_STOPS: readonly [number, string][] = [
  [0, "var(--progress-start)"],
  [0.5, "var(--progress-mid)"],
  [1, "var(--progress-end)"],
];

/** The spectrum as a horizontal CSS gradient (left = 0%, right = 100%). */
export function progressGradient(angle = "90deg"): string {
  const stops = PROGRESS_STOPS.map(([r, c]) => `${c} ${Math.round(r * 100)}%`).join(", ");
  return `linear-gradient(${angle} in oklab, ${stops})`;
}

/** The single spectrum colour at `ratio` (clamped 0–1). Used where only one
 *  colour is shown — an SVG ring stroke, a solid fill. Returns a color-mix()
 *  string interpolating the two surrounding stops in oklab — a straight
 *  perceptual blend (amber → cyan → blue). oklab keeps the warm→cool cross
 *  from detouring through green (which hsl/oklch hue-interpolation would do),
 *  at the cost of a slightly desaturated hand-off near the amber→cyan mid. */
export function progressColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  for (let i = 1; i < PROGRESS_STOPS.length; i++) {
    const [r1, c1] = PROGRESS_STOPS[i - 1];
    const [r2, c2] = PROGRESS_STOPS[i];
    if (t <= r2) {
      const local = r2 === r1 ? 0 : (t - r1) / (r2 - r1);
      return `color-mix(in oklab, ${c1}, ${c2} ${(local * 100).toFixed(1)}%)`;
    }
  }
  return PROGRESS_STOPS[PROGRESS_STOPS.length - 1][1];
}
