import { useEffect, useRef, useState } from "react";

/** The single count-up duration for the whole app — every number tween uses
 *  this (ease-out quad) so no two feel different. Stagger by delaying the
 *  *start* (delayMs), never by changing the duration. */
export const COUNT_UP_MS = 550; // quad ease needs a touch longer to read as "counting"; the number settles just after the 500ms entrance (lands last)

/**
 * Animates a number toward `target`. On first mount it counts up from 0 (a
 * gentle intro); on every later change it tweens from the value currently on
 * screen to the new one — so a weight ticking 92.3 → 92.1 reads as a small,
 * natural settle rather than a jump. `decimals` keeps fractional values smooth
 * (default 0 = integers). `delayMs` staggers the *start* so callers can wave a
 * row/column of numbers in. Honors prefers-reduced-motion by snapping instantly.
 *
 * Returns `null` until the roll actually begins (i.e. through the delay, and
 * again from the moment it's remounted for a replay) so callers render BLANK
 * rather than a stale value or a parked "0" — the digits appear only once they
 * start climbing. A same-instance settle (92.3 → 92.1) never blanks: it's
 * already started, so it keeps showing numbers.
 */
export function useCountUp(
  target: number,
  duration = COUNT_UP_MS,
  decimals = 0,
  delayMs = 0,
): number | null {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  const displayedRef = useRef(0); // always mirrors what's on screen, so interrupts tween from there
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const from = displayedRef.current;
    const delta = target - from;

    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || delta === 0) {
      displayedRef.current = target;
      setValue(target);
      setStarted(true);
      return;
    }

    const factor = Math.pow(10, decimals);
    let start: number | undefined;

    const tick = (now: number) => {
      start ??= now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 2); // ease-out quad — gentler start so the low digits stay readable (visibly counts from 0)
      const cur = Math.round((from + delta * eased) * factor) / factor;
      displayedRef.current = cur;
      setValue(cur);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    const begin = () => {
      setStarted(true); // flips the blank → rolling
      rafRef.current = requestAnimationFrame(tick);
    };
    if (delayMs > 0) timerRef.current = setTimeout(begin, delayMs);
    else begin();

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [target, duration, decimals, delayMs]);

  return started ? value : null;
}
