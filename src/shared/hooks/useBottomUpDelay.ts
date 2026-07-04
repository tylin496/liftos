import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Entrance delay for a count-up: a flat, uniform wait (`--enter-wait`) — the
 * SAME beat as the card rise-in (layout.css) and everything else on the page.
 * The bottom-up cascade was retired in favour of one clean, uniform reveal
 * (100ms wait + --dur-enter, 500ms total), so numbers no longer stagger by
 * position; they roll together with their cards.
 *
 * Still returns `null` until read (one pre-paint pass) so the caller renders
 * blank first, then rolls — a number never flashes a stale value or a parked 0.
 * Keeps the { ref, delayMs } shape so callers are unchanged; the ref just needs
 * to be mounted for the read to run.
 */
export function useBottomUpDelay<T extends Element = HTMLSpanElement>(): {
  ref: RefObject<T>;
  delayMs: number | null;
} {
  const ref = useRef<T>(null);
  const [delayMs, setDelayMs] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // --enter-wait is a root token (inherits everywhere); "100ms" → 100.
    const wait = el ? parseFloat(getComputedStyle(el).getPropertyValue("--enter-wait")) : 0;
    setDelayMs(Number.isFinite(wait) ? wait : 0);
  }, []);

  return { ref, delayMs };
}
