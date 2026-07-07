import { useRef, type TouchEvent as ReactTouchEvent, type RefObject } from "react";

/**
 * Swipe-down-to-dismiss for a bottom sheet. During the drag it writes the
 * transform straight to the DOM (not React state) so the sheet tracks the
 * finger without a re-render per move, and fires `onDismiss` only once the
 * slide-out has visually finished. Dismisses on >90px of travel OR a quick
 * downward flick (velocity sampled from the last move so a short flick counts).
 *
 * Pass the ref of the sheet element itself; spread the returned handlers onto
 * whatever should be draggable (grabber + header). The sheet's CSS must define
 * `.is-dragging` to suspend its entrance transition while the finger is down.
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

  function onTouchStart(e: ReactTouchEvent) {
    startY.current = prevY.current = lastY.current = e.touches[0].clientY;
    prevT.current = lastT.current = e.timeStamp;
    dragging.current = true;
    const el = ref.current;
    if (el) {
      el.style.transition = "none";
      el.classList.add("is-dragging");
    }
  }

  function onTouchMove(e: ReactTouchEvent) {
    if (!dragging.current || !ref.current) return;
    prevY.current = lastY.current;
    prevT.current = lastT.current;
    lastY.current = e.touches[0].clientY;
    lastT.current = e.timeStamp;
    const dy = Math.max(0, e.touches[0].clientY - startY.current);
    ref.current.style.transform = `translateY(${dy}px)`;
  }

  function onTouchEnd(e: ReactTouchEvent) {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const endY = e.changedTouches[0].clientY;
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

  // touchcancel (system gesture / incoming call) skips onTouchEnd — without this
  // the sheet stays frozen mid-drag with transition:none. Snap it back to rest.
  function onTouchCancel() {
    if (!dragging.current || !ref.current) return;
    dragging.current = false;
    const el = ref.current;
    el.style.transition = "transform 200ms ease";
    el.style.transform = "";
    settle(el);
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
