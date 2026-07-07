import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [index, setIndex] = useState<number | null>(null);

  const scrubToClientX = (clientX: number) => {
    const svg = svgRef.current;
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

  return {
    svgRef,
    index,
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}
