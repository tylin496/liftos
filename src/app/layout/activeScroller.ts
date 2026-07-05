// The app scrolls per-tab: each tab panel is its own overflow-y:auto scroll
// container (see Shell.tsx / layout.css), so `window` no longer scrolls. Most
// code positions via scrollIntoView (which finds the panel automatically), but
// a few call sites need to drive the scroller imperatively (scroll-to-top on
// split change, nudge a form above the keyboard, freeze a smooth scroll on
// interrupt). They go through this tiny registry instead of `window`.
//
// Shell registers the active panel whenever a tab commits; there is exactly one
// at a time. Returns null before the first commit (nothing to scroll yet).
let active: HTMLElement | null = null;

export function setActiveScroller(el: HTMLElement | null): void {
  active = el;
}

export function getActiveScroller(): HTMLElement | null {
  return active;
}
