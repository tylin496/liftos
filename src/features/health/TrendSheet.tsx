import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { useChartScrub } from "@shared/hooks/useChartScrub";
import { timelineDate } from "@shared/lib/date";

export interface HealthTrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface HealthTrendConfig {
  label: string;
  unit: string;
  decimals: number;
  color: string;
  points: HealthTrendPoint[];
  /** Which way is "good" for this metric — drives the delta colour AND which
      extreme is the milestone. Weight / Body Fat are false (down-good, so the
      LOW is the win); Lean Mass / Active are true (up-good, so the peak is). */
  higherIsBetter: boolean;
  /** false → the Since-start delta renders neutral (ink, no good/bad tone) while
      higherIsBetter still frames the milestone (Peak/Low). For Lean Mass: some
      lean loss is expected on a cut and the value rides the unreliable BIA
      body-fat reading, so a raw down-move isn't a judgeable "bad" — the Decision
      Engine's LeanMassEvaluation owns that verdict. Default true. */
  judgeDelta?: boolean;
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* Daily-reading progression line. Same shape as Training's exercise trend
   chart (measured getTotalLength() draw-in, press-drag scrub anywhere) —
   this is the "big graph" a Sparkline tap opens. */
function TrendChart({ points, color, unit, decimals, higherIsBetter }: { points: HealthTrendPoint[]; color: string; unit: string; decimals: number; higherIsBetter: boolean }) {
  const W = 320;
  const H = 130;
  const padX = 10;
  const padY = 14;

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const baseline = H - padY;

  const coords = points.map((p, i) => ({
    x: padX + (points.length === 1 ? 0.5 : i / (points.length - 1)) * innerW,
    y: padY + (1 - (p.value - min) / span) * innerH,
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${coords[0].x.toFixed(1)},${baseline} ${line} ${coords[coords.length - 1].x.toFixed(1)},${baseline}`;
  // The gold "best" marker sits on the metric's OWN best extreme — the max for
  // an up-good metric (Lean Mass / Active), the min for a down-good one
  // (Weight / Body Fat), where the low-water mark is the win.
  const best = coords[vals.indexOf(higherIsBetter ? max : min)];
  const last = coords[coords.length - 1];

  // Draw-in animation: measure the polyline's real length rather than using a
  // normalized `pathLength` — see training/TrendSheet.tsx for why (pathLength +
  // vector-effect:non-scaling-stroke + preserveAspectRatio="none" miscomputes
  // the dash pattern on WebKit and clips the final segment).
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

  // Scrub: press-drag anywhere on the chart to inspect any day's date/value.
  const xs = useMemo(() => coords.map((c) => c.x), [coords]);
  const { svgRef, index: scrubIdx, ...scrubHandlers } = useChartScrub(xs, W);

  const scrubCoord = scrubIdx != null ? coords[scrubIdx] : null;
  const scrubPoint = scrubIdx != null ? points[scrubIdx] : null;
  const scrubDate = scrubPoint ? timelineDate(scrubPoint.date) : null;

  return (
    <div className="health-trend-sheet-chart-wrap">
      <svg
        ref={svgRef}
        className="health-trend-sheet-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${unit.trim() || "value"} over time`}
        {...scrubHandlers}
      >
        <defs>
          <linearGradient id="health-trend-sheet-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon className="health-trend-sheet-area" points={area} fill="url(#health-trend-sheet-fill)" />
        <polyline
          ref={lineRef}
          className="health-trend-sheet-line"
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={
            drawLen != null
              ? { strokeDasharray: drawLen, strokeDashoffset: drawn ? 0 : drawLen }
              : { visibility: "hidden" }
          }
        />
        {scrubCoord && (
          <line
            className="health-trend-sheet-guide"
            x1={scrubCoord.x.toFixed(1)}
            y1={padY}
            x2={scrubCoord.x.toFixed(1)}
            y2={baseline}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Peak/last/scrub dots are rendered outside the SVG, not as <circle>s:
          a non-uniform preserveAspectRatio="none" stretch turns an in-SVG
          circle into an ellipse (see overview/page.tsx's weight-spark fix).
          Left is a % (the chart's width is fluid); top is px since H maps 1:1
          to its fixed 130px CSS height. */}
      <div
        className="health-trend-sheet-dot health-trend-sheet-dot--peak"
        style={{ left: `${(best.x / W) * 100}%`, top: `${best.y.toFixed(1)}px` }}
      />
      <div
        className="health-trend-sheet-dot health-trend-sheet-dot--last"
        style={{ left: `${(last.x / W) * 100}%`, top: `${last.y.toFixed(1)}px`, color }}
      />
      {scrubCoord && (
        <div
          className="health-trend-sheet-scrub-dot"
          style={{
            left: `${(scrubCoord.x / W) * 100}%`,
            top: `${scrubCoord.y.toFixed(1)}px`,
            color,
          }}
        />
      )}
      {scrubPoint && scrubCoord && scrubDate && (() => {
        // Anchor by edge near either end of the chart so a wide pill can't
        // overhang the sheet — centered anchor only in the safe middle range.
        const pct = (scrubCoord.x / W) * 100;
        const anchor = pct < 20 ? "start" : pct > 80 ? "end" : "center";
        return (
          <div
            className={`health-trend-sheet-tooltip health-trend-sheet-tooltip--${anchor}`}
            style={{ left: `${pct}%` }}
          >
            <span className="health-trend-sheet-tooltip-date">{scrubDate.mon} {scrubDate.day}</span>
            <span className="mono">{fmt(scrubPoint.value, decimals)}{unit}</span>
          </div>
        );
      })()}
    </div>
  );
}

function SheetInner({
  config,
  closing,
  onClose,
}: {
  config: HealthTrendConfig;
  closing: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { label, unit, decimals, color, points, higherIsBetter, judgeDelta = true } = config;

  const first = points[0];
  const latest = points[points.length - 1];
  const vals = points.map((p) => p.value);
  // The milestone extreme follows the metric's polarity: peak for up-good
  // (Lean Mass / Active), low for down-good (Weight / Body Fat).
  const bestVal = points.length ? (higherIsBetter ? Math.max(...vals) : Math.min(...vals)) : 0;
  const bestLabel = higherIsBetter ? "Peak" : "Low";
  const delta = first && latest ? latest.value - first.value : 0;
  // Colour is judged by the metric's own good direction (NOT raw up=green):
  // a −1.0 kg move is a WIN for Weight. A metric that opted out of judgment
  // (judgeDelta false, e.g. Lean Mass) shows the signed value in neutral ink —
  // the "flat" tone — instead of a verdict colour.
  const isFlat = Math.abs(delta) < 0.05;
  const deltaGood = higherIsBetter ? delta > 0 : delta < 0;
  const deltaCls = isFlat || !judgeDelta ? "flat" : deltaGood ? "good" : "bad";

  // Focus trap + Escape-to-close — the page behind the scrim is inert.
  useFocusTrap(sheetRef, onClose);

  // Swipe-down-to-dismiss on the grabber/header — matches the Settings sheet.
  const { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet health-trend-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label={`${label} trend`}
      >
        <div
          className="settings-sheet-grabber"
          aria-hidden
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        />
        <div
          className="settings-sheet-header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        >
          <span className="settings-sheet-title">{label}</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body health-trend-sheet-body">
          {points.length < 2 ? (
            <p className="health-trend-sheet-empty">
              Not enough readings yet — the trend appears once a few more come in.
            </p>
          ) : (
            <>
              <div className="health-trend-sheet-meta-row">
                <span className="health-trend-sheet-window">Last {points.length} readings</span>
              </div>

              <TrendChart points={points} color={color} unit={unit} decimals={decimals} higherIsBetter={higherIsBetter} />

              <div className="health-trend-sheet-stats">
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">Latest</span>
                  <span className="health-trend-sheet-stat-v">
                    {fmt(latest.value, decimals)}<span className="health-trend-sheet-stat-u">{unit}</span>
                  </span>
                </div>
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">{bestLabel}</span>
                  <span className={`health-trend-sheet-stat-v health-trend-sheet-stat-v--${higherIsBetter ? "peak" : "low"}`}>
                    {fmt(bestVal, decimals)}<span className="health-trend-sheet-stat-u">{unit}</span>
                  </span>
                </div>
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">Since start</span>
                  <span className={`health-trend-sheet-stat-v health-trend-sheet-delta health-trend-sheet-delta--${deltaCls}`}>
                    {isFlat ? "—" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), decimals)}`}
                    {!isFlat && <span className="health-trend-sheet-stat-u">{unit}</span>}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function HealthTrendSheet({
  config,
  open,
  onClose,
}: {
  config: HealthTrendConfig | null;
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted || !config) return null;
  return <SheetInner config={config} closing={closing} onClose={onClose} />;
}
