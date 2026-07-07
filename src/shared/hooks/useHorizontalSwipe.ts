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
   * Also bind mouse drag so the gesture works on desktop (touch is always
   * bound). Opt-in because it suppresses the click that follows a real drag —
   * consumers whose content is click-heavy and don't want desktop drag leave
   * it off. A plain click (no horizontal travel) still passes through.
   */
  pointer?: boolean;
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

// Set while a feature-level horizontal swipe owns the current gesture. Shell's
// app-tab swipe reads this to defer on desktop MOUSE drags — the mouse
// equivalent of the touch path's `stopPropagation` (which already keeps Shell
// out on touch). Only one gesture is active app-wide at a time, so a
// module-level flag is enough. Set on axis-lock, cleared on every gesture end.
let featureHSwipeActive = false;
export function isFeatureHSwipeActive(): boolean {
  return featureHSwipeActive;
}

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
      featureHSwipeActive = false;
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
          featureHSwipeActive = true;
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

    // ── Mouse drag (desktop) — opt-in via `pointer`. Mirrors the touch path.
    // window-level move/up so a drag that leaves the element still tracks and
    // releases cleanly. `suppressClick` swallows the click a real drag emits so
    // dragging across a child button doesn't also activate it.
    let mouseDown = false;
    let suppressClick = false;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return; // left button only
      if (optsRef.current.enabled === false) return;
      mouseDown = true;
      startX = e.clientX;
      startY = e.clientY;
      prevX = lastX = startX;
      prevT = lastT = e.timeStamp;
      axis = null;
      cancelled = false;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
      if (!mouseDown || cancelled) return;
      if (optsRef.current.enabled === false) {
        cancelled = true;
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === null) {
        if (Math.abs(dx) > Math.abs(dy) * AXIS_RATIO && Math.abs(dx) > AXIS_LOCK_PX) {
          axis = "h";
          featureHSwipeActive = true;
        } else if (Math.abs(dy) > AXIS_LOCK_PX) {
          axis = "v"; // vertical mouse drag — bow out, let the page behave normally
          return;
        } else {
          return;
        }
      }
      if (axis === "h") {
        e.preventDefault(); // stop text selection while dragging
        prevX = lastX;
        prevT = lastT;
        lastX = e.clientX;
        lastT = e.timeStamp;
        optsRef.current.onDrag?.(dx);
      }
    }

    function onMouseUp(e: MouseEvent) {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      mouseDown = false;
      if (axis !== "h" || cancelled) {
        reset();
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      reset();
      // A real horizontal drag happened → swallow the click it will emit.
      if (Math.abs(dx) > 5) suppressClick = true;
      const threshold = optsRef.current.threshold ?? 56;
      const horizontalEnough = Math.abs(dx) >= Math.abs(dy) * AXIS_RATIO;
      const dt = e.timeStamp - prevT;
      const velocity = dt > 0 ? (e.clientX - prevX) / dt : 0;
      const farEnough = Math.abs(dx) >= threshold;
      const flicked = Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(dx) >= FLICK_MIN_DX;
      if (horizontalEnough && (farEnough || flicked)) {
        onSwipeRef.current(dx < 0 ? 1 : -1);
      }
      optsRef.current.onDragEnd?.();
    }

    function onClickCapture(e: MouseEvent) {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    const pointer = opts.pointer ?? false;
    if (pointer) {
      el.addEventListener("mousedown", onMouseDown);
      el.addEventListener("click", onClickCapture, true); // capture: beat child handlers
    }
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      if (pointer) {
        el.removeEventListener("mousedown", onMouseDown);
        el.removeEventListener("click", onClickCapture, true);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      }
    };
  }, [ref, opts.pointer]);
}
