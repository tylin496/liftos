import { useEffect, useMemo, useRef, useState } from "react";
import { fetchHealthData, type HealthData } from "./api";
import {
  series,
  bucketSeries,
  rollingAvg,
  regressionSlope,
  computeRecovery,
  type MetricKey,
  type ChartPoint,
  type RecoverySnapshot,
} from "./math";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { ErrorState } from "@shared/components/ErrorState";
import { buildAllDataJson, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useCountUp } from "@shared/hooks/useCountUp";
import { TrendIcon } from "@shared/components/TrendIcon";
import { useTabActivity } from "@app/layout/TabActivityContext";
import "./health.css";

function periodLabel(days: number) {
  return days === 7 ? "THIS WEEK" : `PAST ${days} DAYS`;
}

interface MetricSpec {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  color: string;
  /** Rolling-bucket size in days; also the Card's "this period" averaging window. */
  bucket: number;
}

const METRICS: MetricSpec[] = [
  { key: "weight_kg",    label: "Weight",   unit: "kg", decimals: 1, color: "var(--health-weight)",  bucket: 7  },
  { key: "body_fat_pct", label: "Body Fat", unit: "%",  decimals: 1, color: "var(--health-bodyfat)", bucket: 14 },
];

const FIXED_DAYS = 180;

function LineChart({
  points,
  color,
  decimals = 0,
  unit = "",
}: {
  points: ChartPoint[];
  color: string;
  decimals?: number;
  unit?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setW(Math.round(w));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div className="health-chart-wrap">
        <div className="health-chart-empty" />
      </div>
    );
  }

  const H = 80;
  const PAD = { top: 8, bottom: 20, left: 4, right: 4 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const vals = points.map((p) => p.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rangeV = maxV - minV || 1;

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const toY = (v: number) => PAD.top + (1 - (v - minV) / rangeV) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.value).toFixed(1)}`)
    .join(" ");

  // X-axis labels: pick evenly spaced month ticks
  const tickIndices: number[] = [];
  const maxTicks = 6;
  if (points.length <= maxTicks) {
    points.forEach((_, i) => tickIndices.push(i));
  } else {
    const step = Math.ceil(points.length / maxTicks);
    for (let i = 0; i < points.length; i += step) tickIndices.push(i);
    if (tickIndices.at(-1) !== points.length - 1) tickIndices.push(points.length - 1);
  }

  // Horizontal grid lines (3)
  const gridYs = [0.25, 0.5, 0.75].map((f) => PAD.top + f * innerH);

  function findNearest(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHovered(Math.round(frac * (points.length - 1)));
  }

  const hp = hovered !== null ? points[hovered] : null;
  const hx = hovered !== null ? toX(hovered) : 0;
  const hy = hovered !== null ? toY(points[hovered].value) : 0;
  // Each point is a 7-day average, so the tooltip shows the week it spans,
  // e.g. "22 Jun – 28 Jun" (single day when the bucket holds one reading).
  const fmtDay = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hDate = hp
    ? hp.dateStart === hp.dateEnd
      ? fmtDay(hp.dateEnd)
      : `${fmtDay(hp.dateStart)} – ${fmtDay(hp.dateEnd)}`
    : "";
  const hVal = hp ? fmt(hp.value, decimals) : "";
  // Keep tooltip label inside chart bounds
  const tipX = hx < 40 ? hx + 6 : hx > W - 40 ? hx - 6 : hx;
  const tipAnchor = hx < 40 ? "start" : hx > W - 40 ? "end" : "middle";

  return (
    <div className="health-chart-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="health-chart"
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, touchAction: "none" }}
        onPointerMove={(e) => findNearest(e.clientX)}
        onPointerLeave={() => setHovered(null)}
      >
        {/* Grid lines */}
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
            stroke="var(--rule)"
            strokeWidth="0.5"
            strokeDasharray="3 3"
          />
        ))}

        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data point circles — dimmed when hovering */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(i)} cy={toY(p.value)} r="2.5"
            fill={color}
            opacity={hovered !== null && hovered !== i ? 0.25 : 1}
          />
        ))}

        {/* Hover crosshair + tooltip */}
        {hovered !== null && hp && (
          <>
            <line x1={hx} y1={PAD.top} x2={hx} y2={PAD.top + innerH} stroke={color} strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5" />
            <circle cx={hx} cy={hy} r="4" fill={color} />
            <text x={tipX} y={PAD.top - 1} textAnchor={tipAnchor} fontSize="8.5" fontWeight="700" fill={color} fontFamily="inherit">
              {hVal} {unit}
            </text>
            <text x={tipX} y={PAD.top + 8} textAnchor={tipAnchor} fontSize="7.5" fill="var(--ink-4)" fontFamily="inherit">
              {hDate}
            </text>
          </>
        )}

        {/* X-axis labels */}
        {tickIndices.map((i) => {
          const d = new Date(points[i].date + "T12:00:00");
          const label = d.toLocaleDateString(undefined, { month: "short" });
          return (
            <text
              key={i}
              x={toX(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize="8"
              fill={hovered !== null ? "var(--ink-4)" : "var(--ink-4)"}
              fontFamily="inherit"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function AnimatedTdee({ value }: { value: number }) {
  const count = useCountUp(Math.round(value), 700);
  return <>{count.toLocaleString()}</>;
}

/* Hero metric number — tweens from the value on screen to the new one
   (e.g. weight 92.3 → 92.1) instead of snapping. */
function AnimatedMetric({ value, decimals }: { value: number; decimals: number }) {
  const count = useCountUp(value, 650, decimals);
  return <>{fmt(count, decimals)}</>;
}

/* Subtle per-component direction vs the previous period. Arrow only (the
   headline carries the magnitude); resting usually reads flat since its
   30-day window barely shifts, while active is what actually moves. */
function ComponentTrend({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  const up = diff > 20, down = diff < -20;
  const dir = up ? "up" : down ? "down" : "flat";
  const color = up ? "var(--accent)" : down ? "var(--bad)" : "var(--ink-4)";
  return (
    <span className="health-tdee-component-trend" style={{ color }}>
      <TrendIcon dir={dir} size={12} />
    </span>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Ready:              "var(--good)",
  Good:               "var(--blue)",
  Fair:               "var(--gold)",
  "Needs Recovery":   "var(--bad)",
};

function RecoveryRow({
  label,
  value,
  unit,
  delta,
  higherBetter,
}: {
  label: string;
  value: number | null;
  unit: string;
  delta: number | null;
  higherBetter: boolean;
}) {
  const isGood = delta == null ? null : higherBetter ? delta >= 0 : delta <= 0;
  const deltaColor = isGood == null ? "var(--ink-4)"
    : isGood ? "var(--good)" : "var(--bad)";
  const sign = delta == null ? "" : delta > 0 ? "+" : "";
  const decimals = unit === "h" ? 1 : 0;

  return (
    <div className="health-recovery-row">
      <span className="health-recovery-row-label">{label}</span>
      <span className="health-recovery-row-val">
        {value != null ? fmt(value, decimals) : "—"}
        {value != null && <span className="health-unit"> {unit}</span>}
      </span>
      {delta != null && (
        <span className="health-recovery-row-delta" style={{ color: deltaColor }}>
          {sign}{fmt(Math.abs(delta), decimals)}{unit}
        </span>
      )}
    </div>
  );
}

function RecoveryCard({ snap }: { snap: RecoverySnapshot }) {
  if (!snap.status) return null;

  const sleepDelta = snap.sleepHours != null && snap.sleepBaseline != null
    ? snap.sleepHours - snap.sleepBaseline : null;
  const hrvDelta = snap.hrv != null && snap.hrvBaseline != null
    ? snap.hrv - snap.hrvBaseline : null;
  const rhrDelta = snap.rhr != null && snap.rhrBaseline != null
    ? snap.rhr - snap.rhrBaseline : null;

  const color = STATUS_COLOR[snap.status];

  return (
    <section className="page-card health-recovery">
      <div className="health-recovery-head">
        <span className="health-metric-label">Recovery</span>
        <span className="health-recovery-status" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          {snap.status}
        </span>
      </div>
      <div className="health-recovery-rows">
        <RecoveryRow label="Sleep" value={snap.sleepHours} unit="h"   delta={sleepDelta} higherBetter />
        <RecoveryRow label="HRV"   value={snap.hrv}        unit="ms"  delta={hrvDelta}   higherBetter />
        <RecoveryRow label="RHR"   value={snap.rhr}        unit="bpm" delta={rhrDelta}   higherBetter={false} />
      </div>
      {snap.insight && <p className="health-recovery-footer">{snap.insight}</p>}
    </section>
  );
}

export function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activity = useTabActivity();

  useEffect(() => {
    setData(null);
    fetchHealthData(FIXED_DAYS)
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (activity === 0) return;
    fetchHealthData(FIXED_DAYS).then(setData).catch(() => {});
  }, [activity]);

  useCopyButton(() => buildAllDataJson(FIXED_DAYS, EXPORT_NUTRITION_DAYS));

  const tdee = data?.tdee;
  const tdeePrev = data?.tdeePrev;

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(data.metrics, spec.key);
      const thisWeek = rollingAvg(s, spec.bucket, 0);
      const prevWeek = rollingAvg(s, spec.bucket, spec.bucket);
      const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
      const bucketed = bucketSeries(s, { spanDays: 180, bucketDays: spec.bucket });
      return { spec, bucketed, thisWeek, change, readingCount: s.length };
    });
  }, [data]);

  const recovery = useMemo(() => {
    if (!data) return null;
    return computeRecovery(data.metrics);
  }, [data]);

  const weightPace = useMemo(() => {
    if (!data) return null;
    return regressionSlope(series(data.metrics, "weight_kg"), 28);
  }, [data]);

  const lbmCard = useMemo(() => {
    if (!data) return null;
    const pts = data.metrics
      .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
      .map((m) => ({
        date: m.metric_date,
        value: m.weight_kg! * (1 - m.body_fat_pct! / 100),
      }));
    if (!pts.length) return null;
    const thisWeek = rollingAvg(pts, 14, 0);
    const prevWeek = rollingAvg(pts, 14, 14);
    const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
    const bucketed = bucketSeries(pts, { spanDays: 180, bucketDays: 14 });
    return { thisWeek, change, bucketed, readingCount: pts.length };
  }, [data]);

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="page health">
      {/* TDEE hero — fixed windows, independent of period selector */}
      <section className={`page-card health-tdee${!data ? " loading-card" : ""}`}>
        <p className="page-eyebrow">CURRENT TDEE</p>
        {!data ? (
          <div className="health-tdee-num">
            <span className="health-skel-num">0000</span>
            <span className="health-unit"> kcal/day</span>
          </div>
        ) : tdee?.tdee != null ? (
          <>
            <div className="health-tdee-num">
              <AnimatedTdee value={tdee.tdee} />
              <span className="health-unit"> kcal/day</span>
              {tdeePrev?.tdee != null && (() => {
                const diff = tdee.tdee - tdeePrev.tdee;
                const up = diff > 40, down = diff < -40;
                const dir = up ? "up" : down ? "down" : "flat";
                const color = up ? "var(--accent)" : down ? "var(--bad)" : "var(--ink-4)";
                return (
                  <span className="ov-tdee-arrow" style={{ color }}>
                    <TrendIcon dir={dir} size={15} />
                    {(up || down) ? Math.abs(Math.round(diff)) : null}
                  </span>
                );
              })()}
            </div>
            <div className="health-tdee-components">
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Resting</span>
                <span className="health-tdee-component-val">
                  {tdee.avgResting?.toLocaleString()} kcal/day
                  <ComponentTrend cur={tdee.avgResting} prev={tdeePrev?.avgResting} />
                </span>
                <span className="health-tdee-component-window">
                  {tdee.restingDays < 30 ? `${tdee.restingDays}-day average` : "30-day average"}
                </span>
              </div>
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Active</span>
                <span className="health-tdee-component-val">
                  {tdee.avgActive?.toLocaleString()} kcal/day
                  <ComponentTrend cur={tdee.avgActive} prev={tdeePrev?.avgActive} />
                </span>
                <span className="health-tdee-component-window">
                  {tdee.activeDays < 14 ? `${tdee.activeDays}-day average` : "14-day average"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <p className="page-note">
            No Apple Health data yet. Make sure the iOS Shortcut has synced at least one day.
          </p>
        )}
      </section>

      {recovery && <RecoveryCard snap={recovery} />}

      {/* Metric skeleton while loading */}
      {!data && [0, 1, 2].map((i) => (
        <section className="page-card health-metric loading-card" key={i}>
          <div className="health-metric-head">
            <span className="health-metric-label">Weight</span>
          </div>
          <p className="health-metric-eyebrow">THIS WEEK</p>
          <div className="health-metric-hero">
            <span className="health-metric-val">00.0</span>
            <span className="health-unit">kg</span>
          </div>
          <div className="health-skel-chart" />
        </section>
      ))}

      {/* Metric cards — Apple Health style */}
      {cards.map(({ spec, bucketed, thisWeek, change, readingCount }) => {
        const changePositive = change != null && change > 0;
        const changeNegative = change != null && change < 0;
        const changeCls =
          change == null || readingCount < 2
            ? ""
            : spec.key === "weight_kg" || spec.key === "body_fat_pct"
            ? changeNegative ? " health-metric-change--down" : changePositive ? " health-metric-change--up" : ""
            : "";

        return (
          <section className="page-card health-metric" key={spec.key}>
            <div className="health-metric-head">
              <span className="health-metric-label">{spec.label}</span>
              {spec.key === "weight_kg" && weightPace != null ? (
                <span className={`health-metric-change${
                  weightPace < -0.05 ? " health-metric-change--down" : weightPace > 0.05 ? " health-metric-change--up" : ""
                }`}>
                  {weightPace > 0 ? "+" : ""}{fmt(weightPace, 2)} kg/wk
                </span>
              ) : change != null && readingCount >= 2 ? (
                <span className={`health-metric-change${changeCls}`}>
                  {change > 0 ? "+" : ""}{fmt(change, spec.decimals)} {spec.unit}
                </span>
              ) : null}
            </div>

            <p className="health-metric-eyebrow">{periodLabel(spec.bucket)}</p>
            <div className="health-metric-hero">
              {thisWeek != null ? (
                <>
                  <span className="health-metric-val"><AnimatedMetric value={thisWeek} decimals={spec.decimals} /></span>
                  <span className="health-unit">{spec.unit}</span>
                </>
              ) : (
                <span className="health-metric-val health-metric-val--empty">—</span>
              )}
            </div>
            <LineChart points={bucketed} color={spec.color} decimals={spec.decimals} unit={spec.unit} />
          </section>
        );
      })}

      {/* Lean Mass card — derived from weight × (1 - body_fat%) */}
      {lbmCard && (
        <section className="page-card health-metric">
          <div className="health-metric-head">
            <span className="health-metric-label">Lean Mass</span>
            {lbmCard.change != null && lbmCard.readingCount >= 2 && (
              <span className={`health-metric-change${
                lbmCard.change > 0 ? " health-metric-change--down" : lbmCard.change < 0 ? " health-metric-change--up" : ""
              }`}>
                {lbmCard.change > 0 ? "+" : ""}{fmt(lbmCard.change, 1)} kg
              </span>
            )}
          </div>
          <p className="health-metric-eyebrow">{periodLabel(14)}</p>
          <div className="health-metric-hero">
            {lbmCard.thisWeek != null ? (
              <>
                <span className="health-metric-val"><AnimatedMetric value={lbmCard.thisWeek} decimals={1} /></span>
                <span className="health-unit">kg</span>
              </>
            ) : (
              <span className="health-metric-val health-metric-val--empty">—</span>
            )}
          </div>
          <LineChart points={lbmCard.bucketed} color="var(--health-leanmass)" decimals={1} unit="kg" />
        </section>
      )}
    </div>
  );
}
