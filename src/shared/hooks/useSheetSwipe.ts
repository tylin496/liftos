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
 * Pointer capture (taken on the dragged element) keeps the gesture tracking
 * even when the pointer leaves the grabber/header mid-drag — the CSS grabber +
 * header set `touch-action: none`, which is what lets the pointer stream flow
 * instead of the browser claiming it for a scroll.
 *
 * Pass the ref of the sheet element itself; spread the returned handlers onto
 * whatever should be draggable (grabber + header). The sheet's CSS must define
 * `.is-dragging` to suspend its entrance transition while the pointer is down.
 */
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

  function settle(el: HTMLElement) {
    setTimeout(() => {
      el.style.transition = "";
      el.classList.remove("is-dragging");
    }, 200);
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
    const dy = Math.max(0, e.clientY - startY.current);
    ref.current.style.transform = `translateY(${dy}px)`;
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const endY = e.clientY;
    const dy = Math.max(0, endY - startY.current);
    const dt = e.timeStamp - prevT.current;
    const vy = dt > 0 ? (endY - prevY.current) / dt : 0;
    const el = ref.current;
    el.style.transition = "transform 200ms ease";
    // Dismiss on enough travel OR a quick downward flick.
    if (dy > 90 || (vy >= 0.5 && dy >= 12)) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => onDismissRef.current(), 200);
    } else {
      el.style.transform = "";
      settle(el);
    }
  }

  // pointercancel (system gesture / incoming call / lost capture) skips
  // onPointerUp — without this the sheet stays frozen mid-drag with
  // transition:none. Snap it back to rest.
  function onPointerCancel() {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const el = ref.current;
    el.style.transition = "transform 200ms ease";
    el.style.transform = "";
    settle(el);
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
