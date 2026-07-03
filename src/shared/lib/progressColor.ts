// The single source of truth for progress-indicator colour: every "how far
// toward a goal" element (Cut Progress bar, Active Target ring) shades along
// ONE ember→green "journey" spectrum by its fill ratio — warm ember
// (--progress-start/--progress-mid) → golden amber (--gold) → green (--good).
// This reads as "how far is the journey," never a red→green traffic-light KPI
// scale ("how much is currently failing").
//
// --progress-start/--progress-mid are their OWN tokens — deliberately NOT
// --accent-strong/--accent. Progress meaning ember is load-bearing (this is
// the spectrum's identity), so it must not silently drift if the brand accent
// is ever re-themed to a different color. See tokens.css for the rationale.
//
// PROGRESS_STOPS is shared by two renderers:
//  • a linear-gradient (the bar) reveals the whole spectrum along the track;
//  • progressColor(ratio) samples a single point (the ring's one arc colour).
// Both consume the same stops, so the bar's leading edge and the ring at the
// same % are the same colour.

/** [ratio 0–1, CSS colour] stops. Colours are tokens so they track theme
 *  changes; never hardcode hex here. The --gold anchor at the midpoint keeps
 *  interpolation legible: mixing the ember accent straight to green would
 *  otherwise wander through a muddy/uncertain zone before it resolves, so
 *  routing through gold gives the fade a clear warm midpoint. */
export const PROGRESS_STOPS: readonly [number, string][] = [
  [0, "var(--progress-start)"],
  [0.35, "var(--progress-mid)"],
  [0.6, "var(--gold)"],
  [1, "var(--good)"],
];

/** The spectrum as a horizontal CSS gradient (left = 0%, right = 100%). */
export function progressGradient(angle = "90deg"): string {
  const stops = PROGRESS_STOPS.map(([r, c]) => `${c} ${Math.round(r * 100)}%`).join(", ");
  return `linear-gradient(${angle} in oklab, ${stops})`;
}

/** The single spectrum colour at `ratio` (clamped 0–1). Used where only one
 *  colour is shown — an SVG ring stroke, a solid fill. Returns a color-mix()
 *  string interpolating the two surrounding stops in oklab. oklab gives a
 *  straight perceptual blend (ember → tan → gold → green) with no hue
 *  overshoot or muddy midpoint — kept even though ember (~15°) and gold
 *  (~38°) are close enough in hue that hsl would mostly behave, since a
 *  future re-anchor of either stop must not silently reintroduce the
 *  non-monotonic hsl arc-through-green bug this spectrum was built to avoid. */
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
