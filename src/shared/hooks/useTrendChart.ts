import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useChartScrub } from "./useChartScrub";

// The trend-sheet chart geometry, shared by Training's exercise trend and
// Health's metric trend. Both draw a full-width progression line into a fixed
// 320×130 viewBox stretched by preserveAspectRatio="none", with a measured
// getTotalLength() draw-in and press-drag scrub — identical mechanics that only
// diverged in what they *plot* (the domain) and how they *decorate* it (dots,
// tooltip, corridor, class names). Those stay in each sheet's own JSX; the pure
// coordinate math + draw-in + scrub plumbing live here so they can't drift.
export const TREND_W = 320;
export const TREND_H = 130;
const PAD_X = 10;
const PAD_Y = 14;

/**
 * Compute the shared trend-chart geometry for a series of `values`, mapped onto
 * the caller-supplied y-domain [`min`, `max`]. The caller owns the domain because
 * the two sheets choose it differently — Training uses the raw data extent, Health
 * centres it and widens to a `minSpan` floor so a flat stretch stays flat.
 *
 * Returns:
 *  - `coords` / `line` / `area` — the point coords and polyline/polygon strings
 *  - `valueToY` — the same value→y projection, for decorations (Health's corridor)
 *  - `lineRef` / `lineStyle` — attach to the `<polyline>` for the draw-in animation
 *  - `svgRef` / `scrubIndex` / `scrubHandlers` — attach to the `<svg>` for scrub
 */
export function useTrendChart(values: number[], min: number, max: number) {
  const span = max - min || 1;
  const innerW = TREND_W - PAD_X * 2;
  const innerH = TREND_H - PAD_Y * 2;
  const baseline = TREND_H - PAD_Y;

  const valueToY = (v: number) => PAD_Y + (1 - (v - min) / span) * innerH;
  const coords = values.map((v, i) => ({
    x: PAD_X + (values.length === 1 ? 0.5 : i / (values.length - 1)) * innerW,
    y: valueToY(v),
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  // Empty series → no polygon (callers guard length<2, but keep the hook total
  // rather than crash on coords[0] if one ever slips through).
  const area = coords.length
    ? `${coords[0].x.toFixed(1)},${baseline} ${line} ${coords[coords.length - 1].x.toFixed(1)},${baseline}`
    : "";

  // Draw-in animation: measure the polyline's real length instead of using a
  // normalized `pathLength`. `pathLength` + vector-effect:non-scaling-stroke +
  // preserveAspectRatio="none" (our non-uniform viewBox stretch) miscomputes the
  // dash pattern on WebKit and clips the final segment before the last dot. Real
  // getTotalLength() is immune to that.
  const lineRef = useRef<SVGPolylineElement>(null);
  const [drawLen, setDrawLen] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  useLayoutEffect(() => {
    const len = lineRef.current?.getTotalLength() ?? 0;
    setDrawLen(len);
    setDrawn(false);
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [line]);
  const lineStyle: CSSProperties =
    drawLen != null
      ? { strokeDasharray: drawLen, strokeDashoffset: drawn ? 0 : drawLen }
      : { visibility: "hidden" };

  // Scrub: press-drag anywhere on the chart to inspect any point's date/value.
  const xs = useMemo(() => coords.map((c) => c.x), [coords]);
  const { svgRef, index: scrubIndex, ...scrubHandlers } = useChartScrub(xs, TREND_W);

  return {
    W: TREND_W,
    H: TREND_H,
    padY: PAD_Y,
    baseline,
    coords,
    valueToY,
    line,
    area,
    lineRef,
    lineStyle,
    svgRef,
    scrubIndex,
    scrubHandlers,
  };
}
