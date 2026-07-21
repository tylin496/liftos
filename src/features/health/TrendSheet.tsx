import { useRef } from "react";
import { createPortal } from "react-dom";
import { useChartScrub } from "@shared/hooks/useChartScrub";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { useScrollableFlag } from "@shared/hooks/useScrollableFlag";
import { useTrendChart } from "@shared/hooks/useTrendChart";
import { timelineDate } from "@shared/lib/date";
import { median } from "./math";

interface HealthTrendPoint {
  date: string; // YYYY-MM-DD — representative (middle) day of the bucket
  dateStart?: string; // first day covered by this point's bucket
  dateEnd?: string; // last day covered by this point's bucket
  value: number;
}

export interface HealthTrendConfig {
  label: string;
  unit: string;
  decimals: number;
  color: string;
  points: HealthTrendPoint[];
  /** Days each point averages over (7 for Weight, 14 for Body Fat/Lean Mass,
      ENERGY_BUCKET for Active). Drives the scrub tooltip: >1 shows the day
      range the point covers instead of a single date, since the value is a
      multi-day average, not one reading. */
  bucketDays: number;
  /** Sheet-chart y-domain floor, in this metric's own unit. Below this span the
      domain widens to it (centred on the data) instead of shrinking further, so
      a flat stretch can't fill the chart height and read as dramatic swings —
      the same guard the card sparkline applies. Default 0 (no floor). */
  minSpan?: number;
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
  /** false → the milestone extreme (Peak/Low) renders as a neutral locator, not
      a gold win. Gold is a celebration tone, so it's earned only when the metric
      has a genuine good direction: reaching a new extreme is an achievement.
      Distinct from judgeDelta — Lean Mass opts out of delta judgment (noisy BIA)
      yet a Peak IS a real win (more muscle), so it still celebrates. Resting /
      TDEE have no such win (an estimate's extreme isn't earned) → false.
      Default true. */
  celebrateExtreme?: boolean;
  /** Maintenance zone (± halfWidth in this metric's unit, centred on the drawn
      window's median) drawn behind the line — the full-history counterpart to
      the card sparkline's band (Lean Mass: "still inside the zone?"). Neutral
      ink; it's context, not a verdict. Small and symmetric, so it folds into
      the y-domain to stay in view. */
  band?: { halfWidth: number } | null;
  /** true → the sheet draws 0-based bars instead of the line+area, keeping the
      same mark as the card visual that opened it (Active's daily ActivityBars).
      A bar's length IS the bucket's average output, so the y-domain is 0-based
      and minSpan/band/best-dot (line-chart framing devices) don't apply. */
  bars?: boolean;
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* Scrub-pill date text. Bucketed points (bucketDays > 1) are multi-day
   averages, not single readings — show the day span the average covers, not
   just its representative middle date. */
function scrubDateLabel(p: HealthTrendPoint, bucketDays: number) {
  if (p.dateStart && p.dateEnd && bucketDays > 1) {
    const s = timelineDate(p.dateStart);
    const e = timelineDate(p.dateEnd);
    return `${s.mon} ${s.day}–${e.mon === s.mon ? "" : `${e.mon} `}${e.day}`;
  }
  const d = timelineDate(p.date);
  return `${d.mon} ${d.day}`;
}

/* Daily-reading progression line. Same shape as Training's exercise trend
   chart (measured getTotalLength() draw-in, press-drag scrub anywhere) —
   this is the "big graph" a Sparkline tap opens. */
function TrendChart({ points, color, unit, decimals, higherIsBetter, celebrateExtreme, bucketDays, minSpan = 0, band }: { points: HealthTrendPoint[]; color: string; unit: string; decimals: number; higherIsBetter: boolean; celebrateExtreme: boolean; bucketDays: number; minSpan?: number; band?: { halfWidth: number } | null }) {
  const vals = points.map((p) => p.value);
  // The maintenance band centres on the window median (matching the card
  // sparkline). Its edges fold into the domain so the whole zone stays in view
  // — small and symmetric, unlike the corridor wedge which is clipped instead.
  const bandCenter = band ? median(vals) : null;
  // Widen the domain to minSpan around the data's own centre (matching the card
  // sparkline) so a flat stretch stays flat instead of filling the full height.
  const domainVals = [...vals];
  if (band && bandCenter != null) domainVals.push(bandCenter - band.halfWidth, bandCenter + band.halfWidth);
  const center = (Math.min(...domainVals) + Math.max(...domainVals)) / 2;
  const half = Math.max((Math.max(...domainVals) - Math.min(...domainVals)) / 2, minSpan / 2);
  const min = center - half;
  const max = center + half;
  const { W, H, padY, baseline, coords, valueToY, line, area, lineRef, lineStyle, svgRef, scrubIndex, scrubHandlers } =
    useTrendChart(vals, min, max);

  // Maintenance band: a flat rect from median ± halfWidth, folded into the
  // domain above so it's never clipped. Neutral ink — context, not a verdict.
  const bandGeom =
    band && bandCenter != null
      ? { yTop: valueToY(bandCenter + band.halfWidth), yBot: valueToY(bandCenter - band.halfWidth) }
      : null;
  // The "best" marker sits on the metric's OWN best extreme — the max for an
  // up-good metric (Lean Mass / Active), the min for a down-good one (Weight /
  // Body Fat), where the low-water mark is the win. Gold (a celebration tone)
  // only when celebrateExtreme: metrics with no genuine win (Resting / TDEE)
  // surface the extreme as a neutral locator instead.
  // Search the actual DATA extreme, not the domain bound (min/max): minSpan (and
  // the band's folded-in edges) widen the domain past the data, so a domain
  // bound need not equal any real value — indexOf would return -1 and `best`
  // below would be undefined, crashing at best.x. Matches SheetInner's bestVal.
  const bestIdx = vals.indexOf(higherIsBetter ? Math.max(...vals) : Math.min(...vals));
  const best = coords[bestIdx];
  const lastIdx = coords.length - 1;
  const last = coords[lastIdx];
  // When the latest reading IS the record (a new low/high set right now), the
  // gold best-dot and the magenta last-dot land on the same point and overlap as
  // two hollow rings. Merge them into one record badge: a solid magenta core in a
  // gold ring. Only when the win is celebrated.
  const isRecordNow = celebrateExtreme && bestIdx === lastIdx;

  const scrubCoord = scrubIndex != null ? coords[scrubIndex] : null;
  const scrubPoint = scrubIndex != null ? points[scrubIndex] : null;

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
          {/* Fixed id is safe — the sheet is a singleton, one chart mounted at
              a time (same stance as the gradient id above). */}
          <clipPath id="health-trend-sheet-clip">
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        {bandGeom && (
          <g clipPath="url(#health-trend-sheet-clip)">
            <rect
              x={coords[0].x.toFixed(1)} y={bandGeom.yTop.toFixed(1)}
              width={(coords[coords.length - 1].x - coords[0].x).toFixed(1)}
              height={Math.max(0, bandGeom.yBot - bandGeom.yTop).toFixed(1)}
              fill="var(--ink-4)" opacity="0.1"
            />
            <line
              x1={coords[0].x.toFixed(1)} y1={bandGeom.yTop.toFixed(1)}
              x2={coords[coords.length - 1].x.toFixed(1)} y2={bandGeom.yTop.toFixed(1)}
              stroke="var(--ink-4)" strokeWidth="1" opacity="0.3"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
            <line
              x1={coords[0].x.toFixed(1)} y1={bandGeom.yBot.toFixed(1)}
              x2={coords[coords.length - 1].x.toFixed(1)} y2={bandGeom.yBot.toFixed(1)}
              stroke="var(--ink-4)" strokeWidth="1" opacity="0.3"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
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
          style={lineStyle}
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
      {/* Separate best marker only when the record isn't the latest point —
          otherwise it merges into the last dot below (see isRecordNow). */}
      {bestIdx !== lastIdx && (
        <div
          className={`health-trend-sheet-dot health-trend-sheet-dot--peak${celebrateExtreme ? "" : " is-muted"}`}
          style={{ left: `${(best.x / W) * 100}%`, top: `${best.y.toFixed(1)}px` }}
        />
      )}
      <div
        className={`health-trend-sheet-dot health-trend-sheet-dot--last${isRecordNow ? " is-record" : ""}`}
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
      {scrubPoint && scrubCoord && (() => {
        // Anchor by edge near either end of the chart so a wide pill can't
        // overhang the sheet — centered anchor only in the safe middle range.
        const pct = (scrubCoord.x / W) * 100;
        const anchor = pct < 20 ? "start" : pct > 80 ? "end" : "center";
        return (
          <div
            className={`health-trend-sheet-tooltip health-trend-sheet-tooltip--${anchor}`}
            style={{ left: `${pct}%` }}
          >
            <span className="health-trend-sheet-tooltip-date">{scrubDateLabel(scrubPoint, bucketDays)}</span>
            <span className="mono">{fmt(scrubPoint.value, decimals)}{unit}</span>
          </div>
        );
      })()}
    </div>
  );
}

/* Bar variant of the sheet chart — used when the card visual that opened the
   sheet is itself bars (Active's daily ActivityBars), so the big graph keeps
   the same mark instead of switching to a line. Same press-drag scrub gesture
   and tooltip pill; the held bar keeps full strength and the rest step back.
   No best/last dots or band — the stat row below carries Peak/Latest. */
function TrendBars({ points, color, unit, decimals, bucketDays }: { points: HealthTrendPoint[]; color: string; unit: string; decimals: number; bucketDays: number }) {
  const { svgRef: barsRef, index: scrubIndex, ...scrubHandlers } = useChartScrub<HTMLDivElement>(
    points.map((_, i) => i + 0.5),
    points.length,
  );
  const max = Math.max(...points.map((p) => p.value), 1);
  const latest = points[points.length - 1];
  const scrubPoint = scrubIndex != null ? points[scrubIndex] : null;

  return (
    <div className="health-trend-sheet-chart-wrap">
      <div
        ref={barsRef}
        className={`health-trend-sheet-bars${scrubIndex != null ? " is-scrubbing" : ""}`}
        style={{ color }}
        role="img"
        aria-label={`${unit.trim() || "value"} over time, ${fmt(latest.value, decimals)}${unit} most recently`}
        {...scrubHandlers}
      >
        {points.map((p, i) => (
          <div
            key={p.date}
            className={`health-trend-sheet-bar${i === scrubIndex ? " is-scrubbed" : ""}`}
            style={{ height: `${Math.max((p.value / max) * 100, 1.5)}%` }}
          />
        ))}
      </div>
      {scrubPoint && scrubIndex != null && (() => {
        const pct = ((scrubIndex + 0.5) / points.length) * 100;
        const anchor = pct < 20 ? "start" : pct > 80 ? "end" : "center";
        return (
          <div
            className={`health-trend-sheet-tooltip health-trend-sheet-tooltip--${anchor}`}
            style={{ left: `${pct}%` }}
          >
            <span className="health-trend-sheet-tooltip-date">{scrubDateLabel(scrubPoint, bucketDays)}</span>
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const { label, unit, decimals, color, points, higherIsBetter, judgeDelta = true, celebrateExtreme = true, bucketDays, minSpan = 0, band } = config;

  const first = points[0];
  const latest = points[points.length - 1];
  const vals = points.map((p) => p.value);
  // Middle stat. Up-good metrics (Lean Mass / Active) celebrate their Peak — a
  // hard-won extreme that rarely just mirrors Latest. Down-good metrics (Weight
  // / Body Fat) are driven DOWN almost every reading, so their Low would only
  // restate Latest (and the chart's gold low-dot already flags "at a new best");
  // show the Start anchor instead — neutral, and it reconciles exactly with
  // Since start (Start − Latest = the delta), so the three numbers never fight.
  const bestVal = points.length ? Math.max(...vals) : 0;
  const midLabel = higherIsBetter ? "Peak" : "Start";
  const midVal = higherIsBetter ? bestVal : (first?.value ?? 0);
  const midCelebrate = higherIsBetter && celebrateExtreme;
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
  // Body refuses browser panning unless it really overflows — otherwise the
  // drag falls through the sheet and scrolls the page behind it.
  useScrollableFlag(bodyRef);

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

        <div ref={bodyRef} className="settings-sheet-body health-trend-sheet-body">
          {points.length < 2 ? (
            <p className="health-trend-sheet-empty">
              Not enough readings yet — the trend appears once a few more come in
            </p>
          ) : (
            <>
              <div className="health-trend-sheet-meta-row">
                <span className="health-trend-sheet-window">
                  {(() => {
                    const spanDays = points.length * bucketDays;
                    const months = Math.round(spanDays / 30);
                    const window =
                      months >= 2
                        ? `Last ${months} months`
                        : `Last ${Math.max(1, Math.round(spanDays / 7))} weeks`;
                    return bucketDays > 1 ? `${window} ${bucketDays}-day averages` : window;
                  })()}
                </span>
              </div>

              {config.bars ? (
                <TrendBars points={points} color={color} unit={unit} decimals={decimals} bucketDays={bucketDays} />
              ) : (
                <TrendChart points={points} color={color} unit={unit} decimals={decimals} higherIsBetter={higherIsBetter} celebrateExtreme={celebrateExtreme} bucketDays={bucketDays} minSpan={minSpan} band={band} />
              )}

              <div className="health-trend-sheet-stats">
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">Latest</span>
                  <span className="health-trend-sheet-stat-v">
                    {fmt(latest.value, decimals)}<span className="health-trend-sheet-stat-u">{unit}</span>
                  </span>
                </div>
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">{midLabel}</span>
                  <span className={`health-trend-sheet-stat-v${midCelebrate ? " health-trend-sheet-stat-v--peak" : ""}`}>
                    {fmt(midVal, decimals)}<span className="health-trend-sheet-stat-u">{unit}</span>
                  </span>
                </div>
                <div className="health-trend-sheet-stat">
                  <span className="health-trend-sheet-stat-k">Since start</span>
                  <span className={`health-trend-sheet-stat-v health-trend-sheet-delta health-trend-sheet-delta--${deltaCls}`}>
                    {isFlat ? "—" : `${delta > 0 ? "▲" : "▼"}${fmt(Math.abs(delta), decimals)}`}
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
