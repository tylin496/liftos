import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus inside an open overlay and closes it on Escape — the
 * behaviour `aria-modal` promises. On mount it moves focus into the container
 * (so a keyboard/switch-control user starts inside, not on the page behind the
 * scrim), cycles Tab / Shift+Tab at the edges, and calls `onClose` on Escape.
 *
 * Call it only while the overlay is open — i.e. from a component that unmounts
 * on close (as every sheet/modal here already does via useExitTransition), so
 * the trap installs on open and tears down on close.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Remember what had focus so we can hand it back on close — otherwise a
    // keyboard/switch/screen-reader user is dumped onto <body> (top of the page)
    // every time a sheet closes, losing their place.
    const restoreTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger, but only if focus is still inside the
      // overlay (don't yank it away if something else already claimed it).
      if (restoreTo?.isConnected && root.contains(document.activeElement)) {
        restoreTo.focus();
      }
    };
    // ref is stable; deliberately run once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
