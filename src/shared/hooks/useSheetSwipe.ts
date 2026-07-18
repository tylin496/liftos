import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * Swipe-down-to-dismiss for a bottom sheet. Uses native Pointer Events so the
 * same drag works with a finger on mobile AND a mouse/trackpad on desktop
 * (touch-only handlers left the desktop grabber inert). During the drag it
 * writes the transform straight to the DOM (not React state) so the sheet
 * tracks the pointer without a re-render per move, and fires `onDismiss` only
 * once the slide-out has visually finished. Dismisses on >90px of travel OR a
 * quick downward flick (velocity sampled from the last move so a short flick
 * counts).
 *
 * Feel details (per Apple's Designing Fluid Interfaces):
 * - Dragging UP rubber-bands instead of hard-stopping at 0 — progressive
 *   resistance reads as "responsive, but there's nothing more here".
 * - On release the exit continues at the finger's speed (velocity handoff):
 *   the remaining travel time is `remaining distance ÷ release velocity`,
 *   bounded by the motion role tokens, so there's no visible seam between
 *   dragging and animating. Snap-back likewise scales with return distance.
 *
 * Pointer capture (taken on the dragged element) keeps the gesture tracking
 * even when the pointer leaves the grabber/header mid-drag — the CSS grabber +
 * header set `touch-action: none`, which is what lets the pointer stream flow
 * instead of the browser claiming it for a scroll.
 *
 * Pass the ref of the sheet element itself; spread the returned handlers onto
 * whatever should be draggable (grabber + header). The sheet's CSS must define
 * `.is-dragging` to suspend its entrance transition while the pointer is down.
 */

/* Travel needed to commit a dismiss (px). Doubles as the denominator scaling
   the snap-back duration, so a barely-nudged sheet returns quickly. */
const DISMISS_TRAVEL = 90;

/* Apple's rubber-band constant: the further past the boundary, the less the
   sheet follows — asymptotic, never a hard wall. */
const RUBBER = 0.55;

function rubberband(overshoot: number, dimension: number): number {
  return (overshoot * dimension * RUBBER) / (dimension + RUBBER * Math.abs(overshoot));
}

/* Read a --dur-* role token off the element, in ms. Fallbacks mirror
   tokens.css §Motion — keep in lockstep (same convention as COUNT_UP_MS). */
function readDurMs(el: HTMLElement, token: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(token));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/* Run fn once the transform transition ends. The timer is a WATCHDOG for a
   swallowed transitionend (hidden ancestor, tab switch) — not motion timing. */
function afterTransform(el: HTMLElement, ms: number, fn: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    fn();
  };
  const onEnd = (ev: TransitionEvent) => {
    if (ev.target === el && ev.propertyName === "transform") finish();
  };
  el.addEventListener("transitionend", onEnd);
  const timer = window.setTimeout(finish, ms + 80);
}

export function useSheetSwipe(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const startY = useRef(0);
  const dragging = useRef(false);
  // prev trails last by one move, so a flick is measured from the final frame
  // rather than averaged over the whole gesture.
  const prevY = useRef(0);
  const prevT = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);

  function settle(el: HTMLElement, ms: number) {
    afterTransform(el, ms, () => {
      el.style.transition = "";
      el.classList.remove("is-dragging");
    });
  }

  function onPointerDown(e: ReactPointerEvent) {
    // Mouse: primary button only. Touch/pen report button 0 too.
    if (e.button > 0) return;
    // Don't hijack a press that lands on an interactive control inside the
    // draggable header (appearance toggle, close button). Capturing the pointer
    // here retargets the follow-up click away from that control, so it never
    // fires — leaving those buttons dead. Let the control handle its own press.
    if ((e.target as Element).closest("button, input, a, select, textarea")) return;
    startY.current = prevY.current = lastY.current = e.clientY;
    prevT.current = lastT.current = e.timeStamp;
    dragging.current = true;
    // Capture so a drag that wanders off the grabber still tracks/releases here.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not all pointer ids are capturable (e.g. hover) — safe to ignore */
    }
    const el = ref.current;
    if (el) {
      el.style.transition = "none";
      el.classList.add("is-dragging");
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragging.current || !ref.current) return;
    prevY.current = lastY.current;
    prevT.current = lastT.current;
    lastY.current = e.clientY;
    lastT.current = e.timeStamp;
    const raw = e.clientY - startY.current;
    // Downward tracks 1:1; upward rubber-bands against the sheet's own height.
    const dy = raw >= 0 ? raw : rubberband(raw, ref.current.offsetHeight);
    ref.current.style.transform = `translateY(${dy}px)`;
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const endY = e.clientY;
    const dy = Math.max(0, endY - startY.current);
    const dt = e.timeStamp - prevT.current;
    const vy = dt > 0 ? (endY - prevY.current) / dt : 0; // px/ms, + = downward
    const el = ref.current;
    const slideMs = readDurMs(el, "--dur-slide", 320);
    const pressMs = readDurMs(el, "--dur-press", 120);
    // Dismiss on enough travel OR a quick downward flick.
    if (dy > DISMISS_TRAVEL || (vy >= 0.5 && dy >= 12)) {
      // Velocity handoff: finish the remaining travel at the finger's release
      // speed, clamped to [--dur-press, --dur-slide] — a hard flick exits fast,
      // a slow release never drags past the un-flicked slide.
      const remaining = Math.max(0, el.offsetHeight - dy);
      const ms = vy > 0 ? Math.min(slideMs, Math.max(pressMs, remaining / vy)) : slideMs;
      el.style.transition = `transform ${ms}ms var(--ease-snap)`;
      el.style.transform = "translateY(100%)";
      afterTransform(el, ms, () => onDismissRef.current());
    } else {
      // Snap-back time scales with return distance (a nudge shouldn't take the
      // full-panel duration), same token bounds.
      const ms = Math.min(slideMs, Math.max(pressMs, slideMs * (dy / DISMISS_TRAVEL)));
      el.style.transition = `transform ${ms}ms var(--ease-snap)`;
      el.style.transform = "";
      settle(el, ms);
    }
  }

  // pointercancel (system gesture / incoming call / lost capture) skips
  // onPointerUp — without this the sheet stays frozen mid-drag with
  // transition:none. Snap it back to rest.
  function onPointerCancel() {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const el = ref.current;
    const ms = readDurMs(el, "--dur-slide", 320);
    el.style.transition = `transform ${ms}ms var(--ease-snap)`;
    el.style.transform = "";
    settle(el, ms);
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
