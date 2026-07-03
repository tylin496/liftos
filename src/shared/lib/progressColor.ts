// The single source of truth for progress-indicator colour: every "how far
// toward a goal" element (Cut Progress bar, Active Target ring) shades along
// ONE ember→green spectrum by its fill ratio. Low progress reads warm/ember —
// never red, because being early toward a goal is not a bad verdict (per the
// metric colour rule). It greens as the goal is reached.
//
// PROGRESS_STOPS is shared by two renderers:
//  • a linear-gradient (the bar) reveals the whole spectrum along the track;
//  • progressColor(ratio) samples a single point (the ring's one arc colour).
// Both consume the same stops, so the bar's leading edge and the ring at the
// same % are the same colour.

/** [ratio 0–1, CSS colour] stops. Colours are tokens (or token color-mixes) so
 *  they track theme changes; never hardcode hex here. */
export const PROGRESS_STOPS: readonly [number, string][] = [
  [0, "var(--accent-strong)"],
  [0.4, "var(--accent)"],
  [0.72, "color-mix(in oklab, var(--accent) 35%, var(--good))"],
  [1, "var(--good)"],
];

/** The spectrum as a horizontal CSS gradient (left = 0%, right = 100%). */
export function progressGradient(angle = "90deg"): string {
  const stops = PROGRESS_STOPS.map(([r, c]) => `${c} ${Math.round(r * 100)}%`).join(", ");
  return `linear-gradient(${angle}, ${stops})`;
}

/** The single spectrum colour at `ratio` (clamped 0–1). Used where only one
 *  colour is shown — an SVG ring stroke, a solid fill. Returns a color-mix()
 *  string interpolating the two surrounding stops in oklab. */
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
