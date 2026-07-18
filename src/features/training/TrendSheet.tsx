import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { useTrendChart } from "@shared/hooks/useTrendChart";
import { defaultSetCount } from "./logFormHelpers";
import { buildTrendSeries, windowTrend, type TrendPoint } from "./logic";
import { timelineDate } from "@shared/lib/date";
import { fmtWeightNum } from "./ExprDisplay";
import { formatRepsDisplay } from "./parser";
import { canonicalLift, strengthStanding, isSex, STRENGTH_LEVELS } from "./strengthStandards";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
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
function TrendChart({ points, isVol, isPct, scrubUnit }: { points: TrendPoint[]; isVol: boolean; isPct: boolean; scrubUnit: string }) {
  // Training plots on the raw data extent (no centred/floored domain — that's a
  // Health concern for flat-metric readability).
  const vals = points.map((p) => trendVal(p, isVol));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const { W, H, padY, baseline, coords, line, area, lineRef, lineStyle, svgRef, scrubIndex, scrubHandlers } =
    useTrendChart(vals, min, max);

  const peak = coords[vals.indexOf(max)];
  const last = coords[coords.length - 1];

  const scrubCoord = scrubIndex != null ? coords[scrubIndex] : null;
  const scrubPoint = scrubIndex != null ? points[scrubIndex] : null;
  const scrubDate = scrubPoint ? timelineDate(scrubPoint.date) : null;

  return (
    <div className="trend-chart-wrap">
      <svg
        ref={svgRef}
        className="trend-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={isVol ? "Training volume over time" : isPct ? "Percent of bodyweight lifted over time" : "Estimated one-rep-max over time"}
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
          style={lineStyle}
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
              {fmtVal(trendVal(scrubPoint, isVol), isVol)}{scrubUnit} · {fmtWeightNum(scrubPoint.weightKg)}×{formatRepsDisplay(scrubPoint.reps)}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

/* Strength standard — a 5-rung ladder (Beginner → Elite) with the current lift
   marked. Pure locator, rendered neutral: a level is a fact, not a good/bad
   verdict (the text-color rule reserves colour for verdicts). Only Elite, the
   celebrated ceiling, gets the gold accent. The sub-line reads the bodyweight-
   multiple and the kg left to the next rung — the absolute counterpart to the
   PR-distance the stats above show. */
function StrengthLevel({ standing }: { standing: NonNullable<ReturnType<typeof strengthStanding>> }) {
  const isElite = standing.nextLevel == null;
  return (
    <div className="trend-standard">
      <div className="trend-standard-head">
        <span className="trend-standard-k">Strength level · {standing.liftLabel}</span>
        <span className={`trend-standard-level${isElite ? " is-elite" : ""}`}>{standing.level}</span>
      </div>
      <ol className="trend-standard-ladder" aria-hidden>
        {STRENGTH_LEVELS.map((lvl, i) => (
          <li
            key={lvl}
            className={`trend-standard-rung${i === standing.levelIndex ? " is-current" : ""}${i < standing.levelIndex ? " is-cleared" : ""}${i === 4 ? " is-elite" : ""}`}
          />
        ))}
      </ol>
      <span className="trend-standard-sub mono">
        {standing.ratio.toFixed(2)}× bodyweight
        {standing.nextLevel && standing.kgToNext != null && (
          <> · {fmt1(standing.kgToNext)} kg to {standing.nextLevel}</>
        )}
      </span>
    </div>
  );
}

function SheetInner({
  exercise,
  logs,
  closing,
  onClose,
  bodyweightKg,
}: {
  exercise: Exercise;
  logs: TrainingLog[];
  closing: boolean;
  onClose: () => void;
  bodyweightKg: number | null;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { config } = useNutritionConfig();

  const setCount = defaultSetCount(exercise);
  const { full, win } = useMemo(() => {
    const asc = [...logs].reverse(); // logs arrive newest-first
    const series = buildTrendSeries(asc, setCount, !!exercise.assisted_mode);
    return { full: series, win: windowTrend(series) };
  }, [logs, setCount, exercise.assisted_mode]);

  // Isolation lifts trend on volume (tonnage), compound on Est-1RM — same axis
  // as the Training Health card, so the chart can't contradict the verdict.
  // (Assisted compounds trend on plain %BW lifted, not Est-1RM — see isPct.)
  const isVol = !exercise.compound;
  const points = win.points;
  const first = points[0];
  const latest = points[points.length - 1];
  const peakVal = points.length ? Math.max(...points.map((p) => trendVal(p, isVol))) : 0;
  const latestVal = latest ? trendVal(latest, isVol) : 0;
  const delta = first && latest ? trendVal(latest, isVol) - trendVal(first, isVol) : 0;
  const deltaDir = delta > 0.05 ? "gain" : delta < -0.05 ? "loss" : "flat";
  const windowLabel = win.clipped ? "Last 365 days" : "All time";
  // Assisted lifts score on the plain % of bodyweight lifted (see strengthScore:
  // no Epley, so the number never exceeds 100% BW and reads as real load, not a
  // 1RM projection). The stat is labelled "Lifted", not "Est. 1RM". The read-out
  // matches the card: "%" glues to the number (it modifies the value), "BW" is
  // the small unit label; the delta drops "BW" since the stats beside it already
  // carry it. scrubUnit is the inline tooltip form.
  const isPct = !isVol && exercise.assisted_mode;
  const unitLabel = isVol ? "vol" : exercise.assisted_mode ? "BW" : "kg";
  const scrubUnit = isVol ? " vol" : isPct ? "% BW" : " kg";

  // Strength standard — an ABSOLUTE coordinate alongside the PR-distance read
  // above. Placed off the all-time best e1RM (capability, not the latest set),
  // the user's bodyweight, and configured sex. Null (nothing rendered) unless
  // the lift is a canonical barbell movement, sex is set, and a bodyweight is
  // known — the read stays silent rather than guess. See strengthStandards.ts.
  const allTimeE1rm = full.length ? Math.max(...full.map((p) => p.e1rm)) : null;
  const sex = isSex(config?.sex) ? config.sex : null;
  const standing = strengthStanding(canonicalLift(exercise), allTimeE1rm, bodyweightKg, sex);

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

              <TrendChart points={points} isVol={isVol} isPct={isPct} scrubUnit={scrubUnit} />

              <div className="trend-stats">
                <div className="trend-stat">
                  <span className="trend-stat-k">{isVol ? "Volume" : isPct ? "Lifted" : "Est. 1RM"}</span>
                  <span className="trend-stat-v">
                    {fmtVal(latestVal, isVol)}{isPct ? "%" : ""}{" "}<span className="trend-stat-u">{unitLabel}</span>
                  </span>
                  <span className="trend-stat-sub mono">
                    {fmtWeightNum(latest.weightKg)}×{formatRepsDisplay(latest.reps)}
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Peak</span>
                  <span className="trend-stat-v trend-stat-v--peak">
                    {fmtVal(peakVal, isVol)}{isPct ? "%" : ""}{" "}<span className="trend-stat-u">{unitLabel}</span>
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Since start</span>
                  <span className={`trend-stat-v trend-delta trend-delta--${deltaDir}`}>
                    {deltaDir === "flat" ? "—" : `${delta > 0 ? "▲" : "▼"}${fmtVal(Math.abs(delta), isVol)}${isPct ? "%" : ""}`}
                    {deltaDir !== "flat" && !isPct && <>{" "}<span className="trend-stat-u">{unitLabel}</span></>}
                  </span>
                </div>
              </div>

              {standing && <StrengthLevel standing={standing} />}
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
  bodyweightKg = null,
}: {
  exercise: Exercise;
  logs: TrainingLog[];
  open: boolean;
  onClose: () => void;
  /** Latest bodyweight (kg) — the strength-standard divisor. Null hides it. */
  bodyweightKg?: number | null;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted) return null;
  return <SheetInner exercise={exercise} logs={logs} closing={closing} onClose={onClose} bodyweightKg={bodyweightKg} />;
}
