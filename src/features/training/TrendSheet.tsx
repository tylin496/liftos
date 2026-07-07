import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { defaultSetCount } from "./logFormHelpers";
import { buildTrendSeries, windowTrend, timelineDate, type TrendPoint } from "./logic";
import { fmtWeightNum } from "./ExprDisplay";
import { formatRepsDisplay } from "./parser";
import type { Exercise, TrainingLog } from "./api";

const fmt1 = (v: number) => fmtWeightNum(Math.round(v * 10) / 10);

/* Est-1RM progression line. Fills the sheet width; the peak (all-time within
   the window) is ringed in gold, the latest session in accent. Press-drag from
   the last dot to scrub any point's date/value — the stat row below still
   carries the resting (non-scrubbed) numbers. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 320;
  const H = 130;
  const padX = 10;
  const padY = 14;

  const vals = points.map((p) => p.e1rm);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const baseline = H - padY;

  const coords = points.map((p, i) => ({
    x: padX + (points.length === 1 ? 0.5 : i / (points.length - 1)) * innerW,
    y: padY + (1 - (p.e1rm - min) / span) * innerH,
  }));
  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area = `${coords[0].x.toFixed(1)},${baseline} ${line} ${coords[coords.length - 1].x.toFixed(1)},${baseline}`;
  const peak = coords[vals.indexOf(max)];
  const last = coords[coords.length - 1];

  // Draw-in animation: measure the polyline's real length instead of using a
  // normalized `pathLength`. `pathLength` + vector-effect:non-scaling-stroke +
  // preserveAspectRatio="none" (our non-uniform viewBox stretch) miscomputes
  // the dash pattern on WebKit and clips the final segment before the last
  // dot. Real getTotalLength() is immune to that.
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

  // Scrub: press-drag anywhere on the chart to inspect any point's date/value.
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);

  const scrubToClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || coords.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetX = padX + ratio * innerW;
    let nearest = 0;
    let bestDist = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - targetX);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    });
    setScrubIdx(nearest);
  };

  const onChartPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX);
  };
  const onChartPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (scrubIdx == null) return;
    scrubToClientX(e.clientX);
  };
  const endScrub = () => setScrubIdx(null);

  const scrubCoord = scrubIdx != null ? coords[scrubIdx] : null;
  const scrubPoint = scrubIdx != null ? points[scrubIdx] : null;
  const scrubDate = scrubPoint ? timelineDate(scrubPoint.date) : null;

  return (
    <div className="trend-chart-wrap">
      <svg
        ref={svgRef}
        className="trend-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Estimated one-rep-max over time"
        onPointerDown={onChartPointerDown}
        onPointerMove={onChartPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon className="trend-area" points={area} fill="url(#trend-fill)" />
        <polyline
          ref={lineRef}
          className="trend-line"
          points={line}
          fill="none"
          stroke="var(--accent)"
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
            className="trend-scrub-guide"
            x1={scrubCoord.x.toFixed(1)}
            y1={padY}
            x2={scrubCoord.x.toFixed(1)}
            y2={baseline}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle
          className="trend-dot trend-dot--peak"
          cx={peak.x.toFixed(1)}
          cy={peak.y.toFixed(1)}
          r="4"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          className="trend-dot trend-dot--last"
          cx={last.x.toFixed(1)}
          cy={last.y.toFixed(1)}
          r="3.4"
          vectorEffect="non-scaling-stroke"
        />
        {scrubCoord && (
          <circle
            className="trend-dot trend-dot--scrub"
            cx={scrubCoord.x.toFixed(1)}
            cy={scrubCoord.y.toFixed(1)}
            r="4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {scrubPoint && scrubCoord && scrubDate && (
        <div
          className="trend-tooltip"
          style={{ left: `${Math.min(92, Math.max(8, (scrubCoord.x / W) * 100))}%` }}
        >
          <span className="trend-tooltip-date">{scrubDate.mon} {scrubDate.day}</span>
          <span className="trend-tooltip-val mono">
            {fmt1(scrubPoint.e1rm)}kg · {fmtWeightNum(scrubPoint.weightKg)}×{formatRepsDisplay(scrubPoint.reps)}
          </span>
        </div>
      )}
    </div>
  );
}

function SheetInner({
  exercise,
  logs,
  closing,
  onClose,
}: {
  exercise: Exercise;
  logs: TrainingLog[];
  closing: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  const setCount = defaultSetCount(exercise);
  const { full, win } = useMemo(() => {
    const asc = [...logs].reverse(); // logs arrive newest-first
    const series = buildTrendSeries(asc, setCount);
    return { full: series, win: windowTrend(series) };
  }, [logs, setCount]);

  const points = win.points;
  const first = points[0];
  const latest = points[points.length - 1];
  const peakVal = points.length ? Math.max(...points.map((p) => p.e1rm)) : 0;
  const delta = first && latest ? latest.e1rm - first.e1rm : 0;
  const deltaDir = delta > 0.05 ? "gain" : delta < -0.05 ? "loss" : "flat";
  const windowLabel = win.clipped ? "Last 365 days" : "All time";

  // Focus trap + Escape-to-close — the page behind the scrim is inert.
  useFocusTrap(sheetRef, onClose);

  // Swipe-down-to-dismiss on the grabber/header — matches the Settings sheet.
  const { onTouchStart: onDragStart, onTouchMove: onDragMove, onTouchEnd: onDragEnd, onTouchCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet trend-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label={`${exercise.name} trend`}
      >
        <div
          className="settings-sheet-grabber"
          aria-hidden
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragCancel}
        />
        <div
          className="settings-sheet-header"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragCancel}
        >
          <span className="settings-sheet-title">{exercise.name}</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body trend-sheet-body">
          {points.length < 2 ? (
            <p className="trend-empty">
              {full.length === 0
                ? "No weighted sets logged yet — the strength trend appears once you log a few."
                : "Just getting started — log a few more sessions to see the trend."}
            </p>
          ) : (
            <>
              <div className="trend-meta-row">
                <span className="trend-window">{windowLabel}</span>
                <span className="trend-count">{points.length} sessions</span>
              </div>

              <TrendChart points={points} />

              <div className="trend-stats">
                <div className="trend-stat">
                  <span className="trend-stat-k">Est. 1RM</span>
                  <span className="trend-stat-v">
                    {fmt1(latest.e1rm)}<span className="trend-stat-u">kg</span>
                  </span>
                  <span className="trend-stat-sub mono">
                    {fmtWeightNum(latest.weightKg)}×{formatRepsDisplay(latest.reps)}
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Peak</span>
                  <span className="trend-stat-v trend-stat-v--peak">
                    {fmt1(peakVal)}<span className="trend-stat-u">kg</span>
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Since start</span>
                  <span className={`trend-stat-v trend-delta trend-delta--${deltaDir}`}>
                    {deltaDir === "flat" ? "—" : `${delta > 0 ? "+" : "−"}${fmt1(Math.abs(delta))}`}
                    {deltaDir !== "flat" && <span className="trend-stat-u">kg</span>}
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

export function TrendSheet({
  exercise,
  logs,
  open,
  onClose,
}: {
  exercise: Exercise;
  logs: TrainingLog[];
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted) return null;
  return <SheetInner exercise={exercise} logs={logs} closing={closing} onClose={onClose} />;
}
