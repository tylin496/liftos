import { useEffect, useRef, useState } from "react";

/**
 * Animates a number toward `target`. On first mount it counts up from 0 (a
 * gentle intro); on every later change it tweens from the value currently on
 * screen to the new one — so a weight ticking 92.3 → 92.1 reads as a small,
 * natural settle rather than a jump. `decimals` keeps fractional values smooth
 * (default 0 = integers). Honors prefers-reduced-motion by snapping instantly.
 */
export function useCountUp(target: number, duration = 650, decimals = 0): number {
  const [value, setValue] = useState(0);
  const displayedRef = useRef(0); // always mirrors what's on screen, so interrupts tween from there
  const rafRef = useRef(0);

  useEffect(() => {
    const from = displayedRef.current;
    const delta = target - from;

    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || delta === 0) {
      displayedRef.current = target;
      setValue(target);
      return;
    }

    const factor = Math.pow(10, decimals);
    let start: number | undefined;

    const tick = (now: number) => {
      start ??= now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const cur = Math.round((from + delta * eased) * factor) / factor;
      displayedRef.current = cur;
      setValue(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, decimals]);

  return value;
}
