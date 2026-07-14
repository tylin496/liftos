import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { useChartScrub } from "@shared/hooks/useChartScrub";
import { defaultSetCount } from "./logFormHelpers";
import { buildTrendSeries, windowTrend, type TrendPoint } from "./logic";
import { timelineDate } from "@shared/lib/date";
import { fmtWeightNum } from "./ExprDisplay";
import { formatRepsDisplay } from "./parser";
import type { Exercise, TrainingLog } from "./api";

const fmt1 = (v: number) => fmtWeightNum(Math.round(v * 10) / 10);

// The trend axis follows the lift's ScoreMode: compound plots Est-1RM (kg),
// isolation plots best-set tonnage (a kg·reps volume — NOT a weight, so it never
// goes through fmtWeightNum's lb conversion). One accessor + formatter keeps the
// chart, tooltip, and stat row on the same axis as the Training Health verdict.
const trendVal = (p: TrendPoint, isVol: boolean) => (isVol ? p.tonnage : p.e1rm);
const fmtVal = (v: number, isVol: boolean) => (isVol ? String(Math.round(v)) : fmt1(v));

/* Score progression line (Est-1RM for compound, volume for isolation). Fills the
   sheet width; the peak (all-time within the window) is ringed in gold, the
   latest session in accent. Press-drag from the last dot to scrub any point's
   date/value — the stat row below still carries the resting numbers. */
function TrendChart({ points, isVol, unit }: { points: TrendPoint[]; isVol: boolean; unit: string }) {
  const W = 320;
  const H = 130;
  const padX = 10;
  const padY = 14;

  const vals = points.map((p) => trendVal(p, isVol));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const baseline = H - padY;

  const coords = points.map((p, i) => ({
    x: padX + (points.length === 1 ? 0.5 : i / (points.length - 1)) * innerW,
    y: padY + (1 - (trendVal(p, isVol) - min) / span) * innerH,
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
  const xs = useMemo(() => coords.map((c) => c.x), [coords]);
  const { svgRef, index: scrubIdx, ...scrubHandlers } = useChartScrub(xs, W);

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
        aria-label={isVol ? "Training volume over time" : "Estimated one-rep-max over time"}
        {...scrubHandlers}
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
      </svg>
      {/* Peak/last/scrub dots are rendered outside the SVG, not as
          <circle>s: a non-uniform preserveAspectRatio="none" stretch turns an
          in-SVG circle into an ellipse (see overview/page.tsx's weight-spark
          fix). Left is a % (the chart's width is fluid); top is px since H
          maps 1:1 to its fixed 130px CSS height. */}
      <div
        className="trend-dot trend-dot--peak"
        style={{ left: `${(peak.x / W) * 100}%`, top: `${peak.y.toFixed(1)}px` }}
      />
      <div
        className="trend-dot trend-dot--last"
        style={{ left: `${(last.x / W) * 100}%`, top: `${last.y.toFixed(1)}px` }}
      />
      {scrubCoord && (
        <div
          className="trend-dot trend-dot--scrub"
          style={{ left: `${(scrubCoord.x / W) * 100}%`, top: `${scrubCoord.y.toFixed(1)}px` }}
        />
      )}
      {scrubPoint && scrubCoord && scrubDate && (() => {
        // Anchor by edge, not just clamp the centered left%: a percentage clamp
        // still centers the pill on that point, so a wide pill (long note/reps)
        // can overhang the sheet edge regardless of the clamp range. Flipping
        // the anchor near either edge keeps the whole pill on-screen instead.
        const pct = (scrubCoord.x / W) * 100;
        const anchor = pct < 20 ? "start" : pct > 80 ? "end" : "center";
        return (
          <div
            className={`trend-tooltip trend-tooltip--${anchor}`}
            style={{ left: `${pct}%` }}
          >
            <span className="trend-tooltip-date">{scrubDate.mon} {scrubDate.day}</span>
            <span className="trend-tooltip-val mono">
              {fmtVal(trendVal(scrubPoint, isVol), isVol)}{isVol ? " vol" : unit} · {fmtWeightNum(scrubPoint.weightKg)}×{formatRepsDisplay(scrubPoint.reps)}
            </span>
          </div>
        );
      })()}
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

  // Isolation lifts trend on volume (tonnage), compound on Est-1RM — same axis
  // as the Training Health card, so the chart can't contradict the verdict.
  const isVol = !exercise.compound;
  const points = win.points;
  const first = points[0];
  const latest = points[points.length - 1];
  const peakVal = points.length ? Math.max(...points.map((p) => trendVal(p, isVol))) : 0;
  const latestVal = latest ? trendVal(latest, isVol) : 0;
  const delta = first && latest ? trendVal(latest, isVol) - trendVal(first, isVol) : 0;
  const deltaDir = delta > 0.05 ? "gain" : delta < -0.05 ? "loss" : "flat";
  const windowLabel = win.clipped ? "Last 365 days" : "All time";
  // Assisted lifts score on % of bodyweight lifted (see scoreWeight), so their
  // Est-1RM axis is %BW — kg would misread as an absolute barbell number.
  const unit = isVol ? "vol" : exercise.assisted_mode ? "%BW" : "kg";

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
        className={`settings-sheet trend-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label={`${exercise.name} trend`}
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

              <TrendChart points={points} isVol={isVol} unit={unit} />

              <div className="trend-stats">
                <div className="trend-stat">
                  <span className="trend-stat-k">{isVol ? "Volume" : "Est. 1RM"}</span>
                  <span className="trend-stat-v">
                    {fmtVal(latestVal, isVol)}<span className="trend-stat-u">{unit}</span>
                  </span>
                  <span className="trend-stat-sub mono">
                    {fmtWeightNum(latest.weightKg)}×{formatRepsDisplay(latest.reps)}
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Peak</span>
                  <span className="trend-stat-v trend-stat-v--peak">
                    {fmtVal(peakVal, isVol)}<span className="trend-stat-u">{unit}</span>
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Since start</span>
                  <span className={`trend-stat-v trend-delta trend-delta--${deltaDir}`}>
                    {deltaDir === "flat" ? "—" : `${delta > 0 ? "▲" : "▼"}${fmtVal(Math.abs(delta), isVol)}`}
                    {deltaDir !== "flat" && <span className="trend-stat-u">{unit}</span>}
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
