import { useEffect, useRef, useState } from "react";

/**
 * Cross-fades a displayed value whenever `value` changes: fades the current
 * text out, swaps it at the trough, fades the new text back in. Used for
 * header content that should feel anchored (no horizontal movement) while
 * still signaling a context change. Honors prefers-reduced-motion by
 * swapping instantly.
 */
export function useCrossfade<T>(value: T, halfMs = 90): { displayed: T; fading: boolean } {
  const [displayed, setDisplayed] = useState(value);
  const [fading, setFading] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    if (displayed === value) return;

    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      setDisplayed(value);
      return;
    }

    setFading(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setDisplayed(value);
      setFading(false);
    }, halfMs);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return { displayed, fading };
}
