import { useEffect } from "react";

// A module-level lock that suppresses Shell's cross-tab swipe (and pull-to-
// refresh) for as long as any UI holds it. Same shape as useHorizontalSwipe's
// `featureHSwipeActive` flag, but instead of "a feature swiper owns this drag"
// it means "no tab-level drag should start at all right now."
//
// The one caller today is an open Training edit/add form: a horizontal drag
// while typing weights/reps must not sail off to the next tab and lose the
// in-progress input, and a downward pull must not remount the page out from
// under the form. Because forms live inside many independent ExerciseCards, a
// ref-counter (not a boolean) is what lets several cards' locks overlap without
// one card's cleanup releasing another's.
let locks = 0;

export function isTabSwipeLocked(): boolean {
  return locks > 0;
}

// Imperative acquire/release. Returns the release fn. Internal to this module —
// the only entry point is the useTabSwipeLock hook below.
function acquireTabSwipeLock(): () => void {
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
  };
}

// Hold the lock while `active` is true; released on cleanup / unmount.
export function useTabSwipeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireTabSwipeLock();
  }, [active]);
}
