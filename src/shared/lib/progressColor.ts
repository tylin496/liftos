// The single source of truth for the CONTINUOUS progress-indicator colour:
// every "how far toward a goal" element (Cut Progress bar, Active Target ring,
// top-bar ring) shades along ONE red→green ramp by its fill ratio — red
// (--bad, "just started") crossing to green (--good, "nearly there") by 99%.
//
// COMPLETION is a SEPARATE, DISCRETE state — not part of this ramp. At exactly
// 100% an indicator flips to --progress-complete (gold) as a one-off
// celebration; gold has no range, it only ever means "done." That flip lives
// in the component/CSS (e.g. .goal.is-complete), never in these stops.
//
// PROGRESS_STOPS is shared by two renderers:
//  • a linear-gradient (the bar) reveals the whole spectrum along the track;
//  • progressColor(ratio) samples a single point (a ring's one arc colour).
// Both consume the same stops, so the bar's leading edge and a ring at the
// same % are the same colour.

/** [ratio 0–1, CSS colour] stops for the continuous red→green ramp. Reaches
 *  full green by 99%, leaving the last 1% flat before the discrete 100%
 *  gold flip (handled outside this module). */
export const PROGRESS_STOPS: readonly [number, string][] = [
  [0, "var(--bad)"],
  [0.99, "var(--good)"],
];

/** The spectrum as a horizontal CSS gradient (left = 0%, right = 100%). */
export function progressGradient(angle = "90deg"): string {
  const stops = PROGRESS_STOPS.map(([r, c]) => `${c} ${Math.round(r * 100)}%`).join(", ");
  return `linear-gradient(${angle} in oklab, ${stops})`;
}

/** The single spectrum colour at `ratio` (clamped 0–1). Used where only one
 *  colour is shown — an SVG ring stroke, a solid fill. Returns a color-mix()
 *  string interpolating the two surrounding stops in oklab — a straight
 *  perceptual blend (red → green). */
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
