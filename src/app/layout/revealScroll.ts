// A disclosure that unfolds via a grid-rows transition (0fr→1fr) can, when it
// sits low in a tab, grow behind the floating (position:fixed) tab bar — which
// the scroll container knows nothing about. This keeps the freshly revealed
// content clear of the bar as it unfolds, and ONLY while it would be occluded.
//
// It tracks the REAL geometry frame by frame rather than predicting up front.
// Two earlier shortcuts both failed:
//   • Predicting the grown height from the collapsed body's `scrollHeight`
//     under-reports — a flex body compressed into a 0-height row lets its
//     children shrink, so the measurement comes back short.
//   • Waiting for `transitionend` then scrolling reads as a laggy two-stage
//     motion, and the event doesn't reliably fire for an fr-unit grid transition.
// Measuring the live bottom each frame sidesteps both: it needs no prediction,
// and because it re-applies every frame it also catches up a reveal near the very
// bottom whose scroll room only appears as the panel grows (a single up-front
// scroll clamps against the old, shorter scroll height and stops short).
//
// Per-frame `scrollTop +=` (instant) tracks the unfold at 60fps as one smooth
// glide — the content appears to rise just clear of the bar as it opens. The loop
// stops once the height stops changing (transition settled), with a frame cap as
// a backstop. Call while still collapsed (e.g. inside the setOpen updater) so the
// first frame runs against the freshly-opening reveal.
export function scrollRevealClear(el: HTMLElement | null): void {
  if (!el) return;
  const scroller = el.closest<HTMLElement>(".tab-panel");
  const bar = document.querySelector<HTMLElement>(".tabbar");
  if (!scroller || !bar) return;
  const gap = 12;
  let lastHeight = -1;
  let settledFrames = 0;
  let frames = 0;
  const step = () => {
    const rect = el.getBoundingClientRect();
    const overflow = rect.bottom - bar.getBoundingClientRect().top + gap;
    if (overflow > 0) scroller.scrollTop += overflow;
    // Stop once the reveal's height has held steady for a few frames (the
    // grid-rows transition has settled), or a hard cap in case it never does.
    if (Math.abs(rect.height - lastHeight) < 0.5) {
      if (++settledFrames >= 3) return;
    } else {
      settledFrames = 0;
    }
    lastHeight = rect.height;
    if (++frames < 90) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
