import { useEffect, useMemo, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { defaultSetCount } from "./logFormHelpers";
import { buildTrendSeries, windowTrend, type TrendPoint } from "./logic";
import { fmtWeightNum } from "./ExprDisplay";
import { formatRepsDisplay } from "./parser";
import type { Exercise, TrainingLog } from "./api";

const fmt1 = (v: number) => fmtWeightNum(Math.round(v * 10) / 10);

/* Est-1RM progression line. Fills the sheet width; the peak (all-time within
   the window) is ringed in gold, the latest session in accent — the two beads
   the eye actually looks for. Not scrubbable: it's a glance at the shape of
   progress, the stat row below carries the exact numbers. */
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

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Estimated one-rep-max over time"
    >
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className="trend-area" points={area} fill="url(#trend-fill)" />
      <polyline
        className="trend-line"
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      <circle className="trend-dot trend-dot--peak" cx={peak.x.toFixed(1)} cy={peak.y.toFixed(1)} r="4" />
      <circle className="trend-dot trend-dot--last" cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="3.4" />
    </svg>
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusables = () =>
      Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
    focusables()[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Swipe-down-to-dismiss on the grabber/header — matches the Settings sheet.
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  const dragPrevY = useRef(0);
  const dragPrevT = useRef(0);

  function onDragStart(e: ReactTouchEvent) {
    dragStartY.current = dragPrevY.current = e.touches[0].clientY;
    dragPrevT.current = e.timeStamp;
    isDragging.current = true;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.classList.add("is-dragging");
    }
  }
  function onDragMove(e: ReactTouchEvent) {
    if (!isDragging.current || !sheetRef.current) return;
    dragPrevY.current = e.touches[0].clientY;
    dragPrevT.current = e.timeStamp;
    const dy = Math.max(0, e.touches[0].clientY - dragStartY.current);
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onDragEnd(e: ReactTouchEvent) {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const endY = e.changedTouches[0].clientY;
    const dy = Math.max(0, endY - dragStartY.current);
    const dt = e.timeStamp - dragPrevT.current;
    const vy = dt > 0 ? (endY - dragPrevY.current) / dt : 0;
    const el = sheetRef.current;
    el.style.transition = "transform 200ms ease";
    if (dy > 90 || (vy >= 0.5 && dy >= 12)) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => onCloseRef.current(), 200);
    } else {
      el.style.transform = "";
      setTimeout(() => {
        el.style.transition = "";
        el.classList.remove("is-dragging");
      }, 200);
    }
  }
  function onDragCancel() {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const el = sheetRef.current;
    el.style.transition = "transform 200ms ease";
    el.style.transform = "";
    setTimeout(() => {
      el.style.transition = "";
      el.classList.remove("is-dragging");
    }, 200);
  }

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
