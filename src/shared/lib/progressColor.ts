// The single source of truth for the CONTINUOUS progress-indicator colour:
// every "how far toward a goal" element (Cut Progress bar, Active Target ring,
// top-bar ring) shades along ONE Apple-system spectrum ramp by its fill ratio —
// a warm→cool journey red → orange → green → cyan → blue. progressColor() blends
// only between ADJACENT stops, so the sampled colour is always vivid and never
// muds. Colours live in tokens.css (--progress-1…5), decoupled from the semantic
// --good/--bad and the brand --accent.
//
// COMPLETION is a SEPARATE, DISCRETE state — not part of this ramp. At exactly
// 100% an indicator flips to --progress-complete (gold) as a one-off
// celebration; gold has no range, it only ever means "done." That flip lives
// in the component/CSS (e.g. .goal.is-complete), never in these stops.
//
// progressColor(ratio) samples a single point on the ramp — the ONE colour an
// element shows at its current fill (a bar's solid fill, a ring's arc stroke).
// The whole progress bar is one such colour that shifts as it fills; it is NOT
// a gradient smeared across the track (that reads as dirty). A ring and a bar
// at the same % therefore paint the identical colour.

/** [ratio 0–1, CSS colour] stops for the continuous red→…→blue spectrum ramp,
 *  evenly spaced across the Apple-system stops in tokens.css. The discrete 100%
 *  gold flip is handled outside this module. */
const PROGRESS_STOPS: readonly [number, string][] = [
  [0, "var(--progress-1)"],
  [0.25, "var(--progress-2)"],
  [0.5, "var(--progress-3)"],
  [0.75, "var(--progress-4)"],
  [1, "var(--progress-5)"],
];

/** The single spectrum colour at `ratio` (clamped 0–1). Used where only one
 *  colour is shown — an SVG ring stroke, a solid fill. Returns a color-mix()
 *  string interpolating the two surrounding stops in oklab — a straight
 *  perceptual blend between adjacent Apple spectrum stops. */
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
