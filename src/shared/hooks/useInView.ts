import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Reports whether the referenced element has scrolled into the viewport, then
 * latches true (fires once). Use it to defer entrance animations, count-ups and
 * progress fills until the card is actually seen — cards below the fold no longer
 * play their reveal before the user reaches them.
 *
 * Honors prefers-reduced-motion and a missing IntersectionObserver by reporting
 * "in view" immediately, so gated content is never left hidden.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  threshold = 0.2,
): { ref: RefObject<T>; inView: boolean } {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, inView };
}
