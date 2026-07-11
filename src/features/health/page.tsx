import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { fetchHealthData, type HealthData } from "./api";
import {
  series,
  bucketSeries,
  rollingAvg,
  computeRecovery,
  sanitizeMetrics,
  countSkippedBodyFat,
  latestUpdatedAt,
  median,
  RECOVERY_STATUS_COLOR,
  type MetricKey,
  type ChartPoint,
  type RecoverySnapshot,
} from "./math";
import { localDateStr } from "@shared/lib/date";
import { type MetricKind } from "@shared/lib/freshness";
import { FreshnessTag } from "@shared/components/FreshnessTag";
import { ErrorState } from "@shared/components/ErrorState";
import { AnimatedNumber, HeadlineCountUp } from "@shared/components/AnimatedNumber";
import { COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { PageTopBar } from "@shared/components/PageTopBar";
import { buildHealthJson } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNavExpand } from "@app/layout/NavContext";
import { getActiveScroller } from "@app/layout/activeScroller";
import { HealthTrendSheet, type HealthTrendConfig } from "./TrendSheet";
import "./health.css";

interface MetricSpec {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  color: string;
  /** Rolling-bucket size in days; also the Card's "this period" averaging window. */
  bucket: number;
  avgLabel: string;
  /** Floor for the sparkline's y-domain (in this metric's own unit) — below
      this span, the domain widens to it instead of shrinking further, so a
      0.3 kg wobble can't fill the same vertical range as a 5 kg drop. Each
      card still scales independently; this only stabilizes its own axis. */
  minSpan: number;
}

const METRICS: MetricSpec[] = [
  { key: "weight_kg",    label: "Weight",   unit: "kg", decimals: 1, color: "var(--health-measurement)", bucket: 7,  avgLabel: "7-day average", minSpan: 3 },
  { key: "body_fat_pct", label: "Body Fat", unit: "%",  decimals: 1, color: "var(--health-measurement)", bucket: 14, avgLabel: "14-day average", minSpan: 3 },
];

const FIXED_DAYS = 180;
// Active-energy window: the card's headline averages the last 14 days, its
// distribution bars show those same days, and the trend sheet buckets at it.
const ENERGY_BUCKET = 14;
// Resting energy is slow-moving and noisy day-to-day, so its trend buckets at
// its own 30-day averaging window (the same one its card caption names).
const RESTING_BUCKET = 30;
// Lean-mass maintenance zone: ± this around the window's median. Half a kilo
// of 14-day-averaged lean mass is "unchanged" for practical purposes (BIA
// noise alone covers it) — beads inside read as holding, a walk out the
// bottom edge as a real slide.
const LBM_BAND_HALF_KG = 0.5;
const copyHealthData = () => buildHealthJson();

// Sparkline range follows the card's own averaging window: each bead IS that
// window's average (7-day bucket for Weight, 14-day for Body Fat/Lean Mass),
// so a bead's position means something instead of landing on an arbitrary
// slice. Fixed at 6 beads — the range is however many days that spans
// (Weight → 42d/6wk, Body Fat/Lean Mass → 84d/12wk).
const SPARK_POINTS = 6;

// Entrance clock shared by every spark visual on the page (line draw, zone
// fades, activity bars): each card trails the one below by tier ×
// --stagger-step × 3 after the shared --enter-wait — the sanctioned Health
// cascade (see .health-spark-line in health.css).
const SPARK_TIER_DELAY = "calc(var(--stagger-step) * var(--enter-tier, 0) * 3 + var(--enter-wait))";

/* Wrapper that makes a spark visual its own tap target (opens the big trend
   sheet) without fighting the card's own tap — stopPropagation, same reset
   chrome for every spark shape (line, bars). Inert div when there's no sheet. */
function SparkTap({ onOpen, children }: { onOpen?: () => void; children: ReactNode }) {
  if (!onOpen) return <div className="health-sparkline-wrap">{children}</div>;
  return (
    <div className="health-sparkline-wrap">
      <button
        type="button"
        className="health-sparkline-btn"
        aria-label="View full trend"
        onClick={(e: ReactMouseEvent) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {children}
      </button>
    </div>
  );
}

/* Trend indicator on each Trend card's header (range = its own bucket ×
   SPARK_POINTS) — a glance-only shape. Tapping it opens the big trend sheet
   (all readings, scrubbable); that tap is its own button with stopPropagation
   so it never fights the card's own tap (e.g. Active's Resting/TDEE reveal).

   Two optional context zones render behind the beads:
   - `corridor` — a descending wedge (Overview's weight-corridor geometry at
     sparkline scale): rays fan from the Theil-Sen fit's start level at the
     given min/max weekly decline rates. The caller decides what the rates
     mean (Body Fat passes its composition zone — see bfCorridor).
   - `band` — a horizontal maintenance zone (± halfWidth around the window's
     median): beads staying inside = holding steady. Neutral ink on purpose —
     context, not a verdict. */
function Sparkline({
  points,
  minSpan = 0,
  color = "var(--health-measurement)",
  corridor,
  band,
  onOpen,
}: {
  points: ChartPoint[];
  minSpan?: number;
  color?: string;
  /** Decline band, in this metric's unit per week (positive = falling). */
  corridor?: { minPerWeek: number; maxPerWeek: number } | null;
  /** Maintenance half-width in this metric's unit, centred on the window median. */
  band?: { halfWidth: number } | null;
  onOpen?: () => void;
}) {
  const width = 130, height = 44;
  // useId's delimiters (":r0:") aren't safe inside url(#…) — keep alphanumerics.
  const clipId = `spark-clip-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  if (points.length < 2) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline" />;

  const vals = points.map((p) => p.value);

  // Zone anchors, computed on the beads' real dates (buckets can be sparse, so
  // index spacing isn't a time axis). The corridor anchors at the Theil-Sen
  // fit's level at the window start — same robust-fit reasoning as Overview's
  // weight corridor: anchoring on the first bead would let one odd bucket tilt
  // the whole wedge. The band centres on the window median.
  const t0 = new Date(points[0].date + "T12:00:00").getTime();
  const dayXs = points.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / 86400000);
  const windowDays = dayXs[dayXs.length - 1];
  let corridorAnchor: number | null = null;
  if (corridor && windowDays > 0) {
    const pairSlopes: number[] = [];
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++)
        if (dayXs[j] !== dayXs[i]) pairSlopes.push((vals[j] - vals[i]) / (dayXs[j] - dayXs[i]));
    const fitSlope = median(pairSlopes);
    corridorAnchor = median(vals.map((v, i) => v - fitSlope * dayXs[i]));
  }
  const bandCenter = band ? median(vals) : null;

  // Widen the domain to minSpan around the data's own center rather than
  // shrinking to whatever the actual range is — a flat week and a real move
  // stay visually distinguishable instead of both filling the chart height.
  // Zones join the domain only where they must stay visible: the corridor's
  // apex and the band's edges. The wedge's far end is deliberately left out —
  // over a 12-week window the target drop can dwarf a flat line, and letting
  // it stretch the axis would squash the beads; instead the wedge just exits
  // the frame (clipped), which IS the honest "target is much steeper" read.
  const domainVals = [...vals];
  if (corridorAnchor != null) domainVals.push(corridorAnchor);
  if (band && bandCenter != null) domainVals.push(bandCenter - band.halfWidth, bandCenter + band.halfWidth);
  const dataMin = Math.min(...domainVals);
  const dataMax = Math.max(...domainVals);
  const dataSpan = dataMax - dataMin;
  const center = (dataMax + dataMin) / 2;
  const halfSpan = Math.max(dataSpan, minSpan) / 2;
  const min = center - halfSpan;
  const span = halfSpan * 2 || 1;
  // Inset the plot by the endpoint dot's radius so the "you are here" marker
  // sits fully inside the viewBox instead of poking past the right edge.
  const dot = 2.2;
  // The anchor ("you are here") bead reads slightly larger than the history
  // beads it's threaded among — the size bump is itself part of the signal,
  // not just the colour ring.
  const anchorDot = 4;
  const valueToY = (v: number) => height - dot - ((v - min) / span) * (height - dot * 2);
  const coords = points.map((p, i) => {
    const x = dot + (i / (points.length - 1)) * (width - dot * 2);
    return { x, y: valueToY(p.value) };
  });
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const n = coords.length;

  // Zone geometry in plot space. The corridor wedge fans from the fit's start
  // level down at the band's min/max weekly rates over the drawn window; the
  // band is a flat rect. Both clip to the viewBox (the svg itself is
  // overflow:visible for the anchor ring, so the clip is explicit).
  const corridorGeom =
    corridor && corridorAnchor != null && windowDays > 0
      ? {
          x0: coords[0].x,
          xEnd: last.x,
          y0: valueToY(corridorAnchor),
          yShallow: valueToY(corridorAnchor - corridor.minPerWeek * (windowDays / 7)),
          ySteep: valueToY(corridorAnchor - corridor.maxPerWeek * (windowDays / 7)),
        }
      : null;
  const bandGeom =
    band && bandCenter != null
      ? { yTop: valueToY(bandCenter + band.halfWidth), yBot: valueToY(bandCenter - band.halfWidth) }
      : null;
  // Corridor speaks Overview's healthy-zone language (green wedge = where a
  // well-run cut lands); the band stays neutral ink — maintenance context,
  // not a verdict.
  const zone =
    corridorGeom || bandGeom ? (
      <g clipPath={`url(#${clipId})`}>
        {corridorGeom && (
          <>
            <polygon
              points={`${corridorGeom.x0.toFixed(1)},${corridorGeom.y0.toFixed(1)} ${corridorGeom.xEnd.toFixed(1)},${corridorGeom.yShallow.toFixed(1)} ${corridorGeom.xEnd.toFixed(1)},${corridorGeom.ySteep.toFixed(1)}`}
              fill="var(--good)"
              opacity="0.08"
              stroke="none"
            />
            <line
              x1={corridorGeom.x0.toFixed(1)} y1={corridorGeom.y0.toFixed(1)}
              x2={corridorGeom.xEnd.toFixed(1)} y2={corridorGeom.yShallow.toFixed(1)}
              stroke="var(--good)" strokeWidth="1" opacity="0.28" strokeDasharray="3 3"
            />
            <line
              x1={corridorGeom.x0.toFixed(1)} y1={corridorGeom.y0.toFixed(1)}
              x2={corridorGeom.xEnd.toFixed(1)} y2={corridorGeom.ySteep.toFixed(1)}
              stroke="var(--good)" strokeWidth="1" opacity="0.28" strokeDasharray="3 3"
            />
          </>
        )}
        {bandGeom && (
          <>
            <rect
              x={dot} y={bandGeom.yTop.toFixed(1)}
              width={width - dot * 2} height={Math.max(0, bandGeom.yBot - bandGeom.yTop).toFixed(1)}
              fill="var(--ink-4)" opacity="0.1"
            />
            <line
              x1={dot} y1={bandGeom.yTop.toFixed(1)} x2={width - dot} y2={bandGeom.yTop.toFixed(1)}
              stroke="var(--ink-4)" strokeWidth="1" opacity="0.3" strokeDasharray="3 3"
            />
            <line
              x1={dot} y1={bandGeom.yBot.toFixed(1)} x2={width - dot} y2={bandGeom.yBot.toFixed(1)}
              stroke="var(--ink-4)" strokeWidth="1" opacity="0.3" strokeDasharray="3 3"
            />
          </>
        )}
      </g>
    ) : null;
  const zoneClip = zone ? (
    <defs>
      <clipPath id={clipId}>
        <rect x="0" y="0" width={width} height={height} />
      </clipPath>
    </defs>
  ) : null;

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Apple-style: the line recedes to grey; each reading is a hollow grey bead
  // threaded on it (fill masks the line to read as open). Every bead is the same
  // size — only the latest is ringed in the metric colour, the "you are here"
  // anchor. SPARK_POINTS keeps the beads from crowding.
  const svg = reduced ? (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
      {zoneClip}
      {zone}
      <polyline points={pts} fill="none" stroke="var(--rule-strong)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {coords.slice(0, -1).map((c, i) => (
        <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r={dot} fill="var(--bg-card)" stroke="var(--rule-strong)" strokeWidth="1.4" />
      ))}
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={anchorDot} fill="var(--bg-card)" stroke={color} strokeWidth="2.4" />
    </svg>
  ) : (
    // Draws itself in once, the first time the card mounts with data: the grey
    // line strokes left→right and each bead pops the moment the line reaches it.
    // A background re-fetch updates points in place (same element, no remount), so
    // the draw never restarts — and tab switches don't replay it.
    (() => {
      const dur = 450; // ms — line-draw duration; bead delays are fractions of it.
      // EXCEPTION to the flat entrance: these lines keep a bottom-up cascade (see
      // .health-spark-line), each trailing the card below by tier × --stagger-step × 3
      // after --enter-wait. The line-delay lives in CSS; the beads reuse the SAME
      // expression inline so they stay locked to their line, then trail it left→right.
      const tierDelay = SPARK_TIER_DELAY;
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
          {zoneClip}
          {zone && (
            // Context zone fades in only once the line has finished drawing —
            // the reading lands first, then its frame of reference.
            <g
              className="health-spark-zone"
              style={{ ["--zone-delay" as string]: `calc(${tierDelay} + ${dur}ms)` }}
            >
              {zone}
            </g>
          )}
          <g>
            <polyline
              className="health-spark-line"
              points={pts}
              pathLength={1}
              fill="none"
              stroke="var(--rule-strong)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ ["--spark-dur" as string]: `${dur}ms` }}
            />
            {coords.slice(0, -1).map((c, i) => (
              <circle
                key={i}
                className="health-spark-bead"
                cx={c.x.toFixed(1)}
                cy={c.y.toFixed(1)}
                r={dot}
                fill="var(--bg-card)"
                stroke="var(--rule-strong)"
                strokeWidth="1.4"
                style={{ animationDelay: `calc(${tierDelay} + ${((i / (n - 1)) * dur).toFixed(0)}ms)` }}
              />
            ))}
            <circle
              className="health-spark-anchor-ring"
              cx={last.x.toFixed(1)}
              cy={last.y.toFixed(1)}
              r={anchorDot}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              style={{ animationDelay: `calc(${tierDelay} + ${dur}ms)` }}
            />
            <circle
              className="health-spark-bead health-spark-bead--anchor"
              cx={last.x.toFixed(1)}
              cy={last.y.toFixed(1)}
              r={anchorDot}
              fill="var(--bg-card)"
              stroke={color}
              strokeWidth="2.4"
              style={{ animationDelay: `calc(${tierDelay} + ${dur}ms)` }}
            />
          </g>
        </svg>
      );
    })()
  );

  return <SparkTap onOpen={onOpen}>{svg}</SparkTap>;
}

/* Daily activity distribution for the Active card — one bar per day across the
   exact 14-day window the headline average covers. A bucketed trend line hid
   HOW that average was earned (steady movement vs a few huge days); the
   per-day shape is the decision-relevant read, and the long trend still lives
   in the sheet behind the same tap. Days that met the Active Target render
   solid, days below it faint; the dashed rule is the target itself. Without a
   target every day renders at one weight — distribution only, no judgment. */
function ActivityBars({
  days,
  target,
  onOpen,
}: {
  days: { date: string; value: number | null }[];
  target: number | null;
  onOpen?: () => void;
}) {
  const width = 130, height = 44;
  const vals = days.flatMap((d) => (d.value != null ? [d.value] : []));

  if (!vals.length) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline" />;

  // 0-based kcal scale (a bar's length IS the day's output), topped with a
  // little headroom so the biggest day doesn't kiss the frame.
  const top = Math.max(...vals, target ?? 0) * 1.08 || 1;
  const slot = width / days.length;
  const barW = Math.max(3, slot - 2.5);
  const targetY = target != null ? height - (target / top) * height : null;

  const svg = (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
      {/* Bars + target enter as one flat fade on the page's spark clock — a
          per-bar cascade here would add a fifth stagger; the four sanctioned
          ones are enough. */}
      <g className="health-spark-zone" style={{ ["--zone-delay" as string]: SPARK_TIER_DELAY }}>
        {days.map((d, i) => {
          if (d.value == null) return null; // missed sync = a visible gap, not a zero
          const h = Math.max(1.5, (d.value / top) * height);
          const x = i * slot + (slot - barW) / 2;
          const opacity = target != null ? (d.value >= target ? 0.9 : 0.35) : 0.6;
          return (
            <rect
              key={d.date}
              x={x.toFixed(1)}
              y={(height - h).toFixed(1)}
              width={barW.toFixed(1)}
              height={h.toFixed(1)}
              rx="1.5"
              fill="var(--accent)"
              opacity={opacity}
            />
          );
        })}
        {targetY != null && (
          <line
            x1="0" y1={targetY.toFixed(1)} x2={width} y2={targetY.toFixed(1)}
            stroke="var(--ink-3)" strokeWidth="1" opacity="0.55" strokeDasharray="3 3"
          />
        )}
      </g>
    </svg>
  );

  return <SparkTap onOpen={onOpen}>{svg}</SparkTap>;
}

/* One column of the Energy card's Resting + TDEE model row. Renders as a button
   when a trend is available (tap opens the big scrubbable sheet, same as the
   Active sparkline), else an inert div. stopPropagation keeps the tap from also
   toggling the card's expand/collapse. */
function EnergyModelItem({
  label,
  value,
  window: windowLabel,
  onOpen,
}: {
  label: string;
  value: number | null;
  window: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="health-energy-metric-label">{label}</span>
      <div className="health-trend-stat">
        <MetricValue size="sm" unit="kcal">
          {value != null ? <AnimatedMetric value={value} decimals={0} /> : null}
        </MetricValue>
      </div>
      {/* Fixed descriptor of the trailing window, not the live sample count — a
          single missing day shouldn't tick "30-day average" down to "29". */}
      <span className="health-energy-window">{windowLabel}</span>
    </>
  );
  if (!onOpen) return <div className="health-energy-model-item">{inner}</div>;
  return (
    <button
      type="button"
      className="health-energy-model-item health-energy-model-item--tappable"
      aria-label={`View ${label} trend`}
      onClick={(e: ReactMouseEvent) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {inner}
    </button>
  );
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* A Health metric number. `roll` opts a lg card-headline value into the count-up
   (trend main value + Active hero — arriving data); left off, small parts and
   recovery rows render statically and settle in place. See the handoff §1. */
function AnimatedMetric({
  value,
  decimals,
  roll = false,
}: {
  value: number;
  decimals: number;
  roll?: boolean;
}) {
  const Comp = roll ? HeadlineCountUp : AnimatedNumber;
  return <Comp value={value} decimals={decimals} format={(n) => fmt(n, decimals)} />;
}

/* Fixed 0→ceiling display scales for the recovery gauges. Each metric maps its
   reading to a position on its own physiological scale; RHR is inverted
   (lower = better) so a low resting HR sits further right and reads as "good".
   The band, tick and dot all map through the SAME scale, so "dot at or past the
   band" always means "at or better than your own normal" — no units to parse. */
type GaugeMetric = "sleep" | "hrv" | "rhr";
const GAUGE_SCALE: Record<GaugeMetric, { lo: number; hi: number; invert: boolean }> = {
  sleep: { lo: 0, hi: 10, invert: false },
  hrv: { lo: 0, hi: 80, invert: false },
  rhr: { lo: 40, hi: 90, invert: true },
};

/** Position (2–98%) of a reading on its metric's fixed gauge scale. Clamped off
    the extreme ends so a fill sliver or baseline tick never vanishes at an edge. */
function gaugePct(metric: GaugeMetric, v: number): number {
  const { lo, hi, invert } = GAUGE_SCALE[metric];
  const raw = (v - lo) / (hi - lo);
  const frac = invert ? 1 - raw : raw;
  return Math.max(2, Math.min(98, frac * 100));
}

/** Dot tone: green when the reading is at/past baseline in the healthy
    direction, amber when it's meaningfully below — the SAME per-metric pass
    thresholds computeRecovery scores on (±5% tolerance), so a gauge's colour and
    the overall status can never disagree. Amber is --warn (the app's caution
    colour); --gold stays reserved for celebration, never a "below baseline" read. */
function gaugeTone(metric: GaugeMetric, v: number, baseline: number | null): string {
  if (baseline == null) return "var(--good)";
  const pass = metric === "rhr" ? v <= baseline * 1.05 : v >= baseline * 0.95;
  return pass ? "var(--good)" : "var(--warn)";
}

/* Range gauge: the shaded band is the 30-day normal range, the tick its
   baseline mean, the coloured dot the current 7-day average. Band and tick are
   static; on first reveal the dot travels baseline → today, on the same clock
   and easing as the card's count-ups (COUNT_UP_MS, ease-out-quad bezier —
   mirrors GoalTrack in overview), so the motion itself reads as "where today
   left your baseline". */
function RecoveryGauge({
  pos,
  band,
  tick,
  tone,
}: {
  pos: number;
  band: { lo: number; hi: number } | null;
  tick: number | null;
  tone: string;
}) {
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  const [x, setX] = useState(tick ?? pos);
  useEffect(() => {
    if (delayMs == null) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setX(pos));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, pos]);

  return (
    <div ref={ref} className="health-recovery-gauge">
      {band != null && (
        <span
          className="health-recovery-gauge-band"
          style={{ left: `${band.lo}%`, width: `${band.hi - band.lo}%` }}
        />
      )}
      {tick != null && <span className="health-recovery-gauge-tick" style={{ left: `${tick}%` }} />}
      <span
        className="health-recovery-gauge-dot"
        style={{
          left: `${x}%`,
          backgroundColor: tone,
          transition: `left ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`,
        }}
      />
    </div>
  );
}

function RecoveryRow({
  label,
  metric,
  value,
  unit,
  baseline,
  band,
}: {
  label: string;
  metric: GaugeMetric;
  value: number | null;
  unit: string;
  baseline: number | null;
  band: { lo: number; hi: number } | null;
}) {
  const decimals = unit === "h" ? 1 : 0;

  // Map both band ends through the metric scale, then sort — the RHR scale is
  // inverted, so the value-space lo lands right of the hi in percent space.
  const bandPct = band != null
    ? [gaugePct(metric, band.lo), gaugePct(metric, band.hi)].sort((a, b) => a - b)
    : null;

  return (
    <div className="health-recovery-row">
      <span className="health-recovery-row-label">{label}</span>
      {value != null ? (
        <RecoveryGauge
          pos={gaugePct(metric, value)}
          band={bandPct != null ? { lo: bandPct[0], hi: bandPct[1] } : null}
          tick={baseline != null ? gaugePct(metric, baseline) : null}
          tone={gaugeTone(metric, value, baseline)}
        />
      ) : (
        <div className="health-recovery-gauge" />
      )}
      <span className="health-recovery-row-val">
        <MetricValue size="md" unit={value != null ? unit : undefined}>
          {value != null ? <AnimatedMetric value={value} decimals={decimals} /> : "—"}
        </MetricValue>
      </span>
    </div>
  );
}

function RecoveryCard({ snap, loading = false }: { snap?: RecoverySnapshot | null; loading?: boolean }) {
  // Cold load — same card shell + three rows with placeholder values, resolves
  // in place. Kept mounted alongside the loaded card (same DOM) so readiness
  // data landing doesn't unmount a separate skeleton and replay the entrance.
  if (loading) {
    return (
      <section className="page-card health-recovery loading-card">
        <div className="health-recovery-head">
          <span className="health-card-eyebrow">Recovery</span>
          <span className="health-recovery-status">Loading…</span>
        </div>
        <div className="health-recovery-rows">
          {[
            { label: "Sleep", value: "0.0", unit: "h" },
            { label: "HRV", value: "00", unit: "ms" },
            { label: "RHR", value: "00", unit: "bpm" },
          ].map((r) => (
            <div key={r.label} className="health-recovery-row">
              <span className="health-recovery-row-label">{r.label}</span>
              <div className="health-recovery-gauge" />
              <span className="health-recovery-row-val">
                <MetricValue size="md" unit={r.unit}>{r.value}</MetricValue>
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Stale readiness — the latest sleep/HRV/RHR reading is past the freshness
  // window, so we don't assert a status off an old reading. Show a neutral
  // "can't assess" note instead of vanishing or alarming (decision B of the
  // freshness model). The Decision Engine independently treats stale recovery as
  // unknown, so the two surfaces agree: no verdict from data too old to trust.
  if (snap?.stale && snap.date) {
    return (
      <section className="page-card health-recovery">
        <div className="health-recovery-head">
          <span className="health-card-eyebrow">Recovery</span>
          <span className="health-recovery-head-right">
            <span className="health-recovery-status is-stale">Can’t assess</span>
            <FreshnessTag date={snap.date} kind="recovery" updatedAt={snap.updatedAt} />
          </span>
        </div>
        <p className="health-recovery-footer health-recovery-footer--flush">
          Readiness needs a recent sleep &amp; HRV reading.
        </p>
      </section>
    );
  }

  // Loaded but no readiness data — genuinely nothing to show, so the card
  // collapses (rare; needs sleep/HRV/RHR history).
  if (!snap || !snap.status) return null;

  const color = RECOVERY_STATUS_COLOR[snap.status];

  return (
    <section className="page-card health-recovery">
      <div className="health-recovery-head">
        <span className="health-card-eyebrow">Recovery</span>
        <span className="health-recovery-head-right">
          <span className="health-recovery-status" style={{ color }}>{snap.status}</span>
          <FreshnessTag date={snap.date} kind="recovery" updatedAt={snap.updatedAt} />
        </span>
      </div>
      <div className="health-recovery-rows">
        <RecoveryRow label="Sleep" metric="sleep" value={snap.sleepHours} unit="h"   baseline={snap.sleepBaseline} band={snap.sleepBand} />
        <RecoveryRow label="HRV"   metric="hrv"   value={snap.hrv}        unit="ms"  baseline={snap.hrvBaseline} band={snap.hrvBand} />
        <RecoveryRow label="RHR"   metric="rhr"   value={snap.rhr}        unit="bpm" baseline={snap.rhrBaseline} band={snap.rhrBand} />
      </div>
      <p className="health-recovery-legend">Band = 30-day normal range · dot = 7-day average</p>
      {snap.insight && <p className="health-recovery-footer">{snap.insight}</p>}
    </section>
  );
}

function TrendCard({
  id,
  label,
  avgLabel,
  value,
  unit,
  decimals,
  delta,
  points,
  loading = false,
  note,
  minSpan = 0,
  rangeDays,
  color,
  corridor,
  band,
  onOpenTrend,
  freshnessKind,
  syncDate,
  updatedAt,
}: {
  /** Deep-link anchor — set on the metric that an Overview summary card jumps
   *  to (Weight today), so nav({ scrollTo }) can land on this exact card. */
  id?: string;
  label: string;
  avgLabel: string;
  value: number | null;
  unit: string;
  decimals: number;
  delta: ReactNode;
  points: ChartPoint[];
  loading?: boolean;
  /** Which freshness cadence this card's metric follows — drives the top-right tag. */
  freshnessKind: MetricKind;
  /** Date of this metric's latest real reading (not the bucketed point). */
  syncDate: string | null;
  /** Sync-write timestamp of that reading — shows a clock time for same-day data. */
  updatedAt?: string | null;
  /** Data-quality caveat for this card only — e.g. samples ignored as
      implausible. Rendered under the range line, not shimmer'd. */
  note?: string;
  /** Sparkline y-domain floor, in this metric's own unit. */
  minSpan?: number;
  /** Sparkline span in days — bucketDays × SPARK_POINTS, not a fixed 180. */
  rangeDays: number;
  /** Identity colour for this metric's eyebrow label and sparkline "you are
      here" bead — not a good/bad signal, just which card it belongs to. */
  color?: string;
  /** Target-decline wedge behind the sparkline (see Sparkline). */
  corridor?: { minPerWeek: number; maxPerWeek: number } | null;
  /** Maintenance zone behind the sparkline (see Sparkline). */
  band?: { halfWidth: number } | null;
  /** Tapping the sparkline (only) opens the big scrubbable trend sheet. */
  onOpenTrend?: () => void;
}) {
  return (
    <section id={id} className={`page-card health-trend${loading ? " loading-card" : ""}`}>
      <div className="health-card-top">
        <span className="health-card-eyebrow">{label}</span>
        {!loading && (
          <div className="health-card-top-right">
            <FreshnessTag date={syncDate} kind={freshnessKind} updatedAt={updatedAt} />
            {onOpenTrend && (
              // Explicit disclosure affordance — the sparkline is tappable too, but
              // this right-chevron in the corner is the discoverable "open the full
              // trend sheet" signal. Only shown when there's actually a sheet to open.
              <button
                type="button"
                className="health-trend-open"
                aria-label={`View ${label} trend`}
                onClick={onOpenTrend}
              >
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
                  <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="health-trend-head">
        <div className="health-trend-info">
          <div className="health-trend-stat">
            {loading ? (
              <MetricValue size="lg" unit={unit}>00.0</MetricValue>
            ) : value != null ? (
              <MetricValue size="lg" unit={unit}>
                <AnimatedMetric value={value} decimals={decimals} roll />
              </MetricValue>
            ) : (
              <MetricValue size="lg" className="health-metric-val--empty">—</MetricValue>
            )}
            {delta}
          </div>
        </div>
        <Sparkline points={points} minSpan={minSpan} color={color} corridor={corridor} band={band} onOpen={onOpenTrend} />
      </div>
      <div className="health-trend-foot">
        <MetricCaption>{loading ? "Loading…" : avgLabel}</MetricCaption>
        <div className="health-trend-range">{rangeDays}-day trend</div>
      </div>
      {!loading && note && <p className="health-trend-note">{note}</p>}
    </section>
  );
}

// Body-fat plausibility filtering (isImplausibleBodyFat / sanitizeMetrics /
// countSkippedBodyFat) now lives in ./math so the AI export applies the exact
// same filter — a sample that never reaches a chart must never reach the export.

export function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [energyExpanded, setEnergyExpanded] = useState(false);
  const energyCardRef = useRef<HTMLElement | null>(null);
  const activity = useTabActivity();
  // True only for a user-initiated expand (tapping the card) — gates the
  // scroll-to-bottom settle below. A deep-link expand leaves this false so
  // Shell's startAlign keeps the card TOP-aligned (block:start); pulling to the
  // bottom here would fight that and land the card at the bottom again.
  const settleToBottomRef = useRef(false);

  // A deep-link from Overview's Active Target card asks Active to open on
  // arrival (see the `expand: true` nav call) — it's the only way to reveal the
  // Resting/TDEE breakdown behind it. Shell top-aligns the card as it grows, so
  // this expand must NOT trigger the manual scroll-to-bottom settle.
  const isNavTarget = useNavExpand() === "health-energy-card";
  useEffect(() => {
    if (isNavTarget) {
      settleToBottomRef.current = false;
      setEnergyExpanded(true);
    }
  }, [isNavTarget]);

  // Manual expand only: Active is the last card, so when the user taps it open
  // the revealed Resting/TDEE rows land below the fold, behind the floating tab
  // bar. Scroll the panel to its bottom (its padding-bottom already clears the
  // tab bar) so the model reads without hunting for it. A deep-link expand skips
  // this (settleToBottomRef false) — Shell owns that position, top-aligned. Wait
  // for the grid-rows expand to finish so scrollHeight reflects the settled
  // layout, not the collapsed one.
  useEffect(() => {
    if (!energyExpanded) return;
    if (!settleToBottomRef.current) return;
    const wrap = energyCardRef.current?.querySelector(".health-energy-model-wrap");
    // Not mounted yet — happens on the nav-triggered path, which can flip
    // energyExpanded before `data` loads (see isNavTarget above), while this
    // section is still rendering its `data && tdee?.tdee != null` skeleton
    // branch. Re-running on `data` below retries once it mounts.
    if (!wrap) return;
    // We're already on the committed Health tab (this is a user tap), so the
    // card's own ancestor panel is the live scroller.
    const settle = () => {
      const scroller = energyCardRef.current?.closest<HTMLElement>(".tab-panel") ?? getActiveScroller();
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    };
    // Settle once the grid-rows expand transition ends (scrollHeight is settled
    // by then). A belt-and-suspenders immediate settle covers a browser that
    // wouldn't fire transitionend — idempotent, so a double-fire is harmless.
    settle();
    const onEnd = (e: Event) => {
      if ((e as TransitionEvent).propertyName !== "grid-template-rows") return;
      settle();
    };
    wrap.addEventListener("transitionend", onEnd);
    return () => wrap.removeEventListener("transitionend", onEnd);
  }, [energyExpanded]);

  const load = useCallback(() => {
    return fetchHealthData(FIXED_DAYS)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (activity === 0) return;
    fetchHealthData(FIXED_DAYS).then(setData).catch(() => {});
  }, [activity]);

  const metrics = useMemo(() => (data ? sanitizeMetrics(data.metrics) : []), [data]);
  const skippedBodyFatCount = useMemo(
    () => (data ? countSkippedBodyFat(data.metrics) : 0),
    [data],
  );

  const tdee = data?.tdee;
  const tdeePrev = data?.tdeePrev;
  // Component-level change vs the previous window (active 14→28d). More Active
  // energy = you moved more, so it reads as up = good.
  const activeChange =
    tdee?.avgActive != null && tdeePrev?.avgActive != null
      ? tdee.avgActive - tdeePrev.avgActive
      : null;
  // Resting shows no delta on purpose: resting energy drifting down during a cut
  // is expected metabolic adaptation, not a "bad" move (the Active Target is
  // built around exactly that drift). A metric with no objective good direction
  // gets no coloured delta — same stance as Weight Rate.

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(metrics, spec.key);
      const thisWeek = rollingAvg(s, spec.bucket, 0);
      const prevWeek = rollingAvg(s, spec.bucket, spec.bucket);
      const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
      const bucketed = bucketSeries(s, { spanDays: spec.bucket * SPARK_POINTS, bucketDays: spec.bucket });
      // Full-range version for the big trend sheet: SAME bucket size (so a
      // point still means "this card's own averaging window"), just spanning
      // the whole fetched history instead of only the last SPARK_POINTS beads.
      const full = bucketSeries(s, { spanDays: FIXED_DAYS, bucketDays: spec.bucket });
      const updatedAt = latestUpdatedAt(metrics, spec.key);
      return { spec, bucketed, thisWeek, change, readingCount: s.length, full, updatedAt };
    });
  }, [data, metrics]);

  // Body-fat composition corridor: the zone BF% should occupy given the weight
  // ACTUALLY lost over this same window — not a target pace. Upper edge flat
  // (loss proportional, composition unchanged), lower edge the all-fat ideal
  // (one kg of pure fat off weight W at b% body fat moves BF by 100·(1−b/100)/W
  // points). Deriving from the observed weight trend keeps the wedge on the
  // beads' own scale by construction: lose a lot and it fans wide, plateau and
  // it collapses (and hides) — unlike a target-pace wedge, whose 12-week
  // extrapolation dwarfed the chart and read as a glitch. The read is
  // composition quality — "how much of what you lost was fat" — while the pace
  // verdict itself stays on Overview.
  const bfCorridor = useMemo(() => {
    const w = cards.find((c) => c.spec.key === "weight_kg")?.thisWeek ?? null;
    const bfSpec = METRICS.find((s) => s.key === "body_fat_pct")!;
    const bf = cards.find((c) => c.spec.key === bfSpec.key)?.thisWeek ?? null;
    if (w == null || w <= 0 || bf == null) return null;
    // Theil-Sen slope of raw weight over the BF sparkline's own span, so the
    // wedge and the beads describe the same stretch of time.
    const spanDays = bfSpec.bucket * SPARK_POINTS;
    const weights = series(metrics, "weight_kg");
    if (weights.length < 2) return null;
    const MS = 86400000;
    const tEnd = new Date(weights[weights.length - 1].date + "T12:00:00").getTime();
    const inSpan = weights.filter(
      (p) => new Date(p.date + "T12:00:00").getTime() >= tEnd - (spanDays - 1) * MS,
    );
    if (inSpan.length < 2) return null;
    const xs = inSpan.map((p) => new Date(p.date + "T12:00:00").getTime() / MS);
    const pairSlopes: number[] = [];
    for (let i = 0; i < inSpan.length; i++)
      for (let j = i + 1; j < inSpan.length; j++)
        if (xs[j] !== xs[i]) pairSlopes.push((inSpan[j].value - inSpan[i].value) / (xs[j] - xs[i]));
    const lossPerWeek = -median(pairSlopes) * 7;
    if (lossPerWeek <= 0) return null; // holding or gaining — no fat-loss zone to draw
    const ppPerKg = (100 * (1 - bf / 100)) / w;
    const maxPerWeek = lossPerWeek * ppPerKg;
    // Below ~half a BF point across the whole window the wedge is a sliver —
    // sub-pixel noise dressed up as a zone. Show nothing instead.
    if (maxPerWeek * (spanDays / 7) < 0.5) return null;
    return { minPerWeek: 0, maxPerWeek };
  }, [cards, metrics]);

  // Active energy, per day — the Energy card leads with the distribution of
  // daily output across the exact window its headline averages (see
  // ActivityBars); the 84-day bucketed trend still backs the sheet.
  const energyRaw = useMemo(() => series(metrics, "active_energy_kcal"), [metrics]);
  const activeDaily = useMemo(() => {
    if (!energyRaw.length) return [];
    const MS = 86400000;
    const anchor = new Date(energyRaw[energyRaw.length - 1].date + "T12:00:00").getTime();
    const byDate = new Map(energyRaw.map((p) => [p.date, p.value]));
    return Array.from({ length: ENERGY_BUCKET }, (_, i) => {
      const date = localDateStr(new Date(anchor - (ENERGY_BUCKET - 1 - i) * MS));
      return { date, value: byDate.get(date) ?? null };
    });
  }, [energyRaw]);
  const energyFull = useMemo(
    () => bucketSeries(energyRaw, { spanDays: FIXED_DAYS, bucketDays: ENERGY_BUCKET }),
    [energyRaw],
  );

  // Resting + TDEE trend series — the two model rows now open the same big
  // sheet as Active. Resting keeps its own 30-day averaging window (matches its
  // headline caption); TDEE is the per-day resting+active sum, bucketed at the
  // Active window since Active is what drives its day-to-day movement. Both are
  // model context, not targets — judgeDelta:false so the Since-start delta reads
  // neutral (no good/bad tone), same stance as the card's delta-free Resting.
  const restingFull = useMemo(
    () => bucketSeries(series(metrics, "resting_energy_kcal"), { spanDays: FIXED_DAYS, bucketDays: RESTING_BUCKET }),
    [metrics],
  );
  const tdeeFull = useMemo(() => {
    const pts = metrics
      .filter((m) => m.resting_energy_kcal != null && m.active_energy_kcal != null)
      .map((m) => ({ date: m.metric_date, value: m.resting_energy_kcal! + m.active_energy_kcal! }));
    return bucketSeries(pts, { spanDays: FIXED_DAYS, bucketDays: ENERGY_BUCKET });
  }, [metrics]);

  const recovery = useMemo(() => {
    if (!data) return null;
    return computeRecovery(metrics);
  }, [data, metrics]);

  const lbmCard = useMemo(() => {
    if (!data) return null;
    const rows = metrics.filter((m) => m.weight_kg != null && m.body_fat_pct != null);
    const pts = rows.map((m) => ({
      date: m.metric_date,
      value: m.weight_kg! * (1 - m.body_fat_pct! / 100),
    }));
    if (!pts.length) return null;
    const thisWeek = rollingAvg(pts, 14, 0);
    const prevWeek = rollingAvg(pts, 14, 14);
    const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
    const lbmBucket = 14;
    const bucketed = bucketSeries(pts, { spanDays: lbmBucket * SPARK_POINTS, bucketDays: lbmBucket });
    const full = bucketSeries(pts, { spanDays: FIXED_DAYS, bucketDays: lbmBucket });
    return {
      thisWeek, change, bucketed, readingCount: pts.length,
      rangeDays: lbmBucket * SPARK_POINTS, bucketDays: lbmBucket, full,
      lastDate: pts.at(-1)?.date ?? null,
      updatedAt: rows.at(-1)?.updated_at ?? null,
    };
  }, [data, metrics]);

  // The big scrubbable trend sheet — one shared instance, driven by which
  // card's sparkline was tapped. `trendConfig` is left populated after close
  // (harmless once `trendOpen` is false) so the exit transition still has
  // content to animate out, same pattern as Training's per-exercise sheet.
  const [trendConfig, setTrendConfig] = useState<HealthTrendConfig | null>(null);
  const [trendOpen, setTrendOpen] = useState(false);
  const openTrend = (config: HealthTrendConfig) => {
    setTrendConfig(config);
    setTrendOpen(true);
  };

  const header = (
    <div className="shell-header">
      <PageTopBar eyebrow="HEALTH" title="Trends" onCopy={copyHealthData} />
    </div>
  );

  if (error && !data) {
    return (
      <div className="page">
        {header}
        <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="page health">
      {header}
      {/* 1. Recovery — sleep / HRV / RHR readiness snapshot. Always mounted (own
          skeleton while loading); collapses only if there's genuinely no
          readiness data. Sits first: a day-to-day state read before the
          longer-arc body-composition and TDEE cards. */}
      <RecoveryCard loading={!data} snap={recovery} />

      {/* 2. Trend cards — Weight, then Body Fat (body-composition read). Always
          mounted; each renders its own skeleton (placeholder values) while
          loading, then resolves the SAME DOM to real values when data lands —
          no separate skeleton subtree to unmount, so the entrance plays once. */}
      {METRICS.map((spec) => {
        const c = cards.find((x) => x.spec.key === spec.key);
        return (
          <TrendCard
            key={spec.key}
            // Deep-link anchor for Overview's Weight summary card (only Weight —
            // Body Fat has no Overview summary that jumps here).
            id={spec.key === "weight_kg" ? "health-weight-card" : undefined}
            loading={!data}
            label={spec.label}
            avgLabel={spec.avgLabel}
            value={c ? c.thisWeek : null}
            unit={spec.unit}
            decimals={spec.decimals}
            points={c ? c.bucketed : []}
            minSpan={spec.minSpan}
            rangeDays={spec.bucket * SPARK_POINTS}
            color={spec.color}
            // Body Fat carries the composition wedge (observed weight loss
            // translated to BF points — see bfCorridor). Weight stays bare:
            // its pace verdict already lives on Overview's corridor card.
            corridor={spec.key === "body_fat_pct" ? bfCorridor : null}
            freshnessKind={spec.key === "weight_kg" ? "weight" : "bodyComp"}
            syncDate={series(metrics, spec.key).at(-1)?.date ?? null}
            updatedAt={c?.updatedAt ?? null}
            delta={
              // Both Weight and Body Fat are down-good on a cut — this page is the
              // body-composition trend view, so each carries its own coloured
              // delta (the smoothed rolling average, not a single noisy day; the
              // threshold still suppresses changes within noise). Overview's weight
              // card stays delta-free because its pace/Status read covers it there.
              c && c.change != null && c.readingCount >= 2 ? (
                <MetricDelta value={c.change} direction="down-good" decimals={spec.decimals} unit={spec.unit} />
              ) : null
            }
            note={
              spec.key === "body_fat_pct" && skippedBodyFatCount > 0
                ? `Skipped ${skippedBodyFatCount} invalid body fat sample${skippedBodyFatCount === 1 ? "" : "s"}`
                : undefined
            }
            onOpenTrend={
              c && c.full.length >= 2
                // Weight and Body Fat are both down-good (matches the hardcoded
                // down-good MetricDelta on the card above).
                // Weight's sheet carries the target-pace corridor (the nutrition
                // evaluation's band) — the full-history counterpart to Overview's
                // recent-window corridor. The small sparkline stays bare on
                // purpose: the recent pace verdict already lives on Overview.
                ? () => openTrend({
                    label: spec.label, unit: spec.unit, decimals: spec.decimals, color: spec.color,
                    points: c.full, higherIsBetter: false, bucketDays: spec.bucket,
                    corridor: spec.key === "weight_kg" && data?.weightTargetRange
                      ? { minPerWeek: data.weightTargetRange.min, maxPerWeek: data.weightTargetRange.max }
                      : null,
                  })
                : undefined
            }
          />
        );
      })}

      {/* 3. Lean Mass — derived from weight × (1 − body_fat%). Always mounted so it
          holds its slot; shows "—" when there's genuinely no body-fat data,
          same as Weight / Body Fat handle a missing value. */}
      <TrendCard
        loading={!data}
        label="Lean Mass"
        avgLabel="14-day average"
        value={lbmCard ? lbmCard.thisWeek : null}
        unit="kg"
        decimals={1}
        points={lbmCard ? lbmCard.bucketed : []}
        minSpan={2}
        rangeDays={lbmCard ? lbmCard.rangeDays : 14 * SPARK_POINTS}
        color="var(--health-measurement)"
        // Maintenance band, matching the card's whole stance: holding lean mass
        // through a cut is the win, so the visual asks "still inside the zone?"
        // instead of "which way is it pointing?". Neutral ink like the change
        // figure — context, not a verdict (see the delta comment below).
        band={{ halfWidth: LBM_BAND_HALF_KG }}
        freshnessKind="bodyComp"
        syncDate={lbmCard?.lastDate ?? null}
        updatedAt={lbmCard?.updatedAt ?? null}
        delta={
          // Neutral on purpose, NOT a MetricDelta: a 14-day lean-mass move isn't
          // judgeable at face value. Some lean loss is expected on any cut (what
          // matters is its share of total loss), and the number itself is derived
          // from the unreliable BIA body-fat reading — so an up-good red here
          // mostly flags normal cutting. The real "losing muscle" verdict is the
          // Decision Engine's LeanMassEvaluation (60-day fit + SE gate), which
          // fires the protect-muscle directive when the slide is statistically real.
          lbmCard && lbmCard.change != null && lbmCard.readingCount >= 2 &&
          Number(Math.abs(lbmCard.change).toFixed(1)) !== 0 ? (
            <span className="health-lbm-change">
              {lbmCard.change > 0 ? "↑" : "↓"}
              {Math.abs(lbmCard.change).toFixed(1)} kg
            </span>
          ) : null
        }
        onOpenTrend={
          lbmCard && lbmCard.full.length >= 2
            ? () => openTrend({ label: "Lean Mass", unit: "kg", decimals: 1, color: "var(--health-measurement)", points: lbmCard.full, higherIsBetter: true, judgeDelta: false, bucketDays: lbmCard.bucketDays })
            : undefined
        }
      />

      {/* 4. Energy — the metabolic model behind the ring. Active leads with its
          daily distribution (behaviour-driven); Resting + TDEE ride below as
          context so Resting + Active = TDEE still adds up. */}
      <section
        ref={energyCardRef}
        id="health-energy-card"
        className={`page-card health-energy${!data ? " loading-card" : ""}`}
        {...(data && tdee?.tdee != null
          ? {
              role: "button" as const,
              tabIndex: 0,
              "aria-expanded": energyExpanded,
              // A user tap opts into the scroll-to-bottom settle (reveal the
              // model below the fold); a deep-link expand does not (see the
              // settle effect). Ref, not state — it only gates the effect, never
              // renders. Set regardless of direction: on collapse the settle
              // effect early-returns, so the flag is a no-op until the next open.
              onClick: () => {
                settleToBottomRef.current = true;
                setEnergyExpanded((v) => !v);
              },
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  settleToBottomRef.current = true;
                  setEnergyExpanded((v) => !v);
                }
              },
            }
          : {})}
      >
        <div className="health-tdee-head">
          <span className="health-card-eyebrow">Active</span>
          <span className="health-tdee-head-right">
            {data && (
              <FreshnessTag
                date={series(metrics, "active_energy_kcal").at(-1)?.date ?? null}
                kind="sync"
                updatedAt={latestUpdatedAt(metrics, "active_energy_kcal")}
              />
            )}
            <span className={`health-energy-chevron${energyExpanded ? " is-open" : ""}`} aria-hidden>
              <svg width="13" height="8" viewBox="0 0 12 7" fill="none">
                <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
        </div>
        {!data ? (
          <>
            <div className="health-trend-head">
              <div className="health-trend-info">
                <div className="health-trend-stat">
                  <MetricValue size="lg" unit="kcal">000</MetricValue>
                </div>
              </div>
              <ActivityBars days={[]} target={null} />
            </div>
            <div className="health-trend-foot">
              <MetricCaption>Loading…</MetricCaption>
              <div className="health-trend-range">Last {ENERGY_BUCKET} days</div>
            </div>
          </>
        ) : tdee?.tdee != null ? (
          <>
            {/* Active leads with the daily distribution — the behaviour-driven
                shape behind the average. */}
            <div className="health-trend-head">
              <div className="health-trend-info">
                <div className="health-trend-stat">
                  <MetricValue size="lg" unit="kcal">
                    {tdee.avgActive != null ? <AnimatedMetric value={tdee.avgActive} decimals={0} roll /> : null}
                  </MetricValue>
                  {activeChange != null && (
                    <MetricDelta value={activeChange} direction="up-good" decimals={0} />
                  )}
                </div>
              </div>
              <ActivityBars
                days={activeDaily}
                target={data.activeTarget?.activeTargetPerDay ?? null}
                onOpen={
                  energyFull.length >= 2
                    ? () => openTrend({ label: "Active", unit: " kcal", decimals: 0, color: "var(--accent)", points: energyFull, higherIsBetter: true, bucketDays: ENERGY_BUCKET })
                    : undefined
                }
              />
            </div>
            <div className="health-trend-foot">
              <MetricCaption>
                {/* Fixed descriptor of the trailing window, not the sample
                    count — a single missing day shouldn't tick it to "13". */}
                14-day average
              </MetricCaption>
              <div className="health-trend-range">Last {ENERGY_BUCKET} days</div>
            </div>

            {/* Resting + TDEE — the model behind the ring, revealed on tapping the
                card, so Resting + Active = TDEE still visibly adds up. Always
                mounted (not conditionally rendered) so the grid-rows collapse
                can animate instead of the content just vanishing. */}
            <div className={`health-energy-model-wrap${energyExpanded ? " is-open" : ""}`}>
              <div className="health-energy-model">
                <EnergyModelItem
                  label="Resting"
                  value={tdee.avgResting}
                  window="30-day average"
                  // 30-day average of resting energy — a slow metabolic drift,
                  // no objective good direction (down = expected adaptation on a
                  // cut), so the trend delta reads neutral. Only tappable once
                  // there's enough history for a line.
                  onOpen={
                    restingFull.length >= 2
                      ? () => openTrend({ label: "Resting", unit: " kcal", decimals: 0, color: "var(--accent)", points: restingFull, higherIsBetter: false, judgeDelta: false, celebrateExtreme: false, bucketDays: RESTING_BUCKET })
                      : undefined
                  }
                />
                <EnergyModelItem
                  label="TDEE"
                  value={tdee.tdee}
                  window="resting + active"
                  onOpen={
                    tdeeFull.length >= 2
                      ? () => openTrend({ label: "TDEE", unit: " kcal", decimals: 0, color: "var(--accent)", points: tdeeFull, higherIsBetter: true, judgeDelta: false, celebrateExtreme: false, bucketDays: ENERGY_BUCKET })
                      : undefined
                  }
                />
              </div>
            </div>
          </>
        ) : (
          <p className="page-note">
            No Apple Health data yet. Make sure the iOS Shortcut has synced at least one day.
          </p>
        )}
      </section>

      <HealthTrendSheet config={trendConfig} open={trendOpen} onClose={() => setTrendOpen(false)} />
    </div>
  );
}
