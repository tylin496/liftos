import { useEffect, useRef, type RefObject } from "react";

// Release-to-commit horizontal swipe. Shared by the three sub-page swipes that
// each "own" the horizontal gesture and stop it bubbling to Shell's tab-swipe:
//   • training split switcher
//   • nutrition day navigation
//   • nutrition week-strip navigation
//
// The finger-following tab swipe in Shell is a different interaction (live drag
// + snap) and intentionally does NOT use this hook.
//
// dir semantics match Shell: 1 = finger swiped left (advance / next / forward),
// −1 = finger swiped right (back / previous). Guards (range limits, haptics) are
// the caller's job — this hook only decides that a committed horizontal swipe
// happened. A commit is either enough travel (`threshold`) OR a fast enough
// flick — so a quick short swipe registers the way it does natively.

export interface HorizontalSwipeOptions {
  /** Minimum horizontal travel to commit. Default 56px. */
  threshold?: number;
  /** When false, in-flight and new gestures are ignored (e.g. an editor is open). */
  enabled?: boolean;
  /**
   * Live finger offset (raw px, sign follows the finger) while the gesture is
   * locked horizontal. Opt in to a follow-the-finger drag; apply your own
   * damping/clamping. Fires only after the axis locks to "h".
   */
  onDrag?: (dx: number) => void;
  /**
   * Gesture ended (committed, snapped back, or cancelled). Reset any transform
   * applied in onDrag here. Fires once per horizontal gesture, after onSwipe.
   */
  onDragEnd?: () => void;
}

// Travel before we lock onto an axis. Once locked horizontal we claim the
// gesture; once locked vertical we bow out so the page scrolls normally.
const AXIS_LOCK_PX = 10;
// Horizontal must beat vertical by this ratio to count as a horizontal swipe.
const AXIS_RATIO = 1.25;
// A quick flick commits even below `threshold`: past this release speed
// (px/ms) with at least FLICK_MIN_DX of travel, we treat it as intentional.
// ~0.5px/ms is a brisk swipe; a slow drag sits well under 0.2.
const FLICK_VELOCITY = 0.5;
const FLICK_MIN_DX = 12;

export function useHorizontalSwipe<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onSwipe: (dir: 1 | -1) => void,
  opts: HorizontalSwipeOptions = {},
): void {
  // Keep callback + options fresh without re-binding listeners every render.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let axis: "h" | "v" | null = null;
    let cancelled = false;
    // Velocity sampling for flick detection. prev* trails last* by one move so
    // the release speed isn't measured against a near-zero time delta (touchend
    // often fires within a millisecond of the final touchmove).
    let prevX = 0;
    let prevT = 0;
    let lastX = 0;
    let lastT = 0;

    function reset() {
      axis = null;
      cancelled = false;
    }

    function onTouchStart(e: TouchEvent) {
      // Second finger down mid-gesture: bail rather than let touches[0] swap
      // out from under us and produce a jumped delta.
      if (e.touches.length !== 1) {
        cancelled = true;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      prevX = lastX = startX;
      prevT = lastT = e.timeStamp;
      axis = null;
      cancelled = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (cancelled || e.touches.length !== 1) return;
      if (optsRef.current.enabled === false) {
        cancelled = true;
        return;
      }
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (axis === null) {
        if (Math.abs(dx) > Math.abs(dy) * AXIS_RATIO && Math.abs(dx) > AXIS_LOCK_PX) {
          axis = "h";
        } else if (Math.abs(dy) > AXIS_LOCK_PX) {
          axis = "v";
          return;
        } else {
          return;
        }
      }
      if (axis === "h") {
        e.preventDefault();
        e.stopPropagation();
        prevX = lastX;
        prevT = lastT;
        lastX = e.touches[0].clientX;
        lastT = e.timeStamp;
        optsRef.current.onDrag?.(dx);
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (axis !== "h" || cancelled) {
        reset();
        return;
      }
      e.stopPropagation();
      const endX = e.changedTouches[0].clientX;
      const dx = endX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      reset();
      const threshold = optsRef.current.threshold ?? 56;
      const horizontalEnough = Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO;
      const dt = e.timeStamp - prevT;
      const velocity = dt > 0 ? (endX - prevX) / dt : 0;
      const farEnough = Math.abs(dx) >= threshold;
      const flicked = Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(dx) >= FLICK_MIN_DX;
      if (horizontalEnough && (farEnough || flicked)) {
        onSwipeRef.current(dx < 0 ? 1 : -1);
      }
      optsRef.current.onDragEnd?.();
    }

    // touchcancel (iOS notification pull, edge gesture, incoming call) fires
    // instead of touchend — reset so we don't strand a half-tracked gesture.
    function onTouchCancel() {
      const wasHorizontal = axis === "h";
      reset();
      if (wasHorizontal) optsRef.current.onDragEnd?.();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [ref]);
}
