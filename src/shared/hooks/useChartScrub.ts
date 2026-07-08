import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Press-drag anywhere on an SVG sparkline/chart to scrub to the nearest data
 * point by x position. Native Pointer Events (mouse + touch, no extra libs) —
 * spread the returned handlers onto the `<svg>` element.
 *
 * `xs` are each point's x-coordinate in the same user-space units as
 * `viewBoxWidth` (the numbers already used to lay out the chart); this is
 * viewBox-relative, so it works under `preserveAspectRatio="none"` stretching.
 */
export function useChartScrub(xs: number[], viewBoxWidth: number) {
  const elRef = useRef<SVGSVGElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  const scrubToClientX = (clientX: number) => {
    const svg = elRef.current;
    if (!svg || xs.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetX = ratio * viewBoxWidth;
    let nearest = 0;
    let bestDist = Infinity;
    xs.forEach((x, i) => {
      const d = Math.abs(x - targetX);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    });
    setIndex(nearest);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (index == null) return;
    scrubToClientX(e.clientX);
  };
  const end = () => setIndex(null);

  // Pointer events (above) drive the actual scrub tracking, but a touch
  // gesture ALSO dispatches a parallel native TouchEvent stream that Shell's
  // own ancestor listener uses for the cross-tab swipe (see
  // useHorizontalSwipe.ts). stopPropagation on a pointer event does nothing to
  // that separate stream, so without this a chart drag on a touch device also
  // triggered Shell's tab-swipe. A press anywhere on the chart always means
  // "scrub", never "swipe" — so this claims the touch unconditionally (no
  // axis-lock needed) the moment it starts on the chart, same
  // descendant-listener-fires-first trick useHorizontalSwipe already relies on.
  //
  // This MUST be a callback ref, not a plain useRef + useEffect(..., []): some
  // callers (e.g. Overview's Weight card) render a placeholder <svg> with no
  // ref attached while loading, then swap to the real, ref'd chart in the SAME
  // component instance once data lands. A mount-only effect already ran (and
  // bailed, since the ref was null then) and never fires again — so the real
  // chart's listeners silently never attach. A callback ref re-fires on every
  // attach/detach, so it catches that later swap.
  const cleanupRef = useRef<(() => void) | null>(null);
  const svgRef = useCallback((el: SVGSVGElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    elRef.current = el;
    if (!el) return;
    const stop = (e: TouchEvent) => e.stopPropagation();
    el.addEventListener("touchstart", stop, { passive: true });
    el.addEventListener("touchmove", stop, { passive: true });
    el.addEventListener("touchend", stop, { passive: true });
    el.addEventListener("touchcancel", stop, { passive: true });
    cleanupRef.current = () => {
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("touchmove", stop);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("touchcancel", stop);
    };
  }, []);

  return {
    svgRef,
    index,
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}
