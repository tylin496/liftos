import { useEffect, useMemo, useRef, useState } from "react";
import { fetchHealthData, type BodyMetric, type HealthData } from "./api";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { buildAllDataJson, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useCountUp } from "@shared/hooks/useCountUp";
import { TrendIcon } from "@shared/components/TrendIcon";
import { useTabActivity } from "@app/layout/TabActivityContext";
import "./health.css";

type MetricKey = "weight_kg" | "body_fat_pct" | "active_energy_kcal" | "resting_energy_kcal";

interface MetricSpec {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  color: string;
}

const METRICS: MetricSpec[] = [
  { key: "weight_kg",           label: "Weight",         unit: "kg",   decimals: 1, color: "#5e9cf5" },
  { key: "body_fat_pct",        label: "Body Fat",       unit: "%",    decimals: 1, color: "#bf5af2" },
  { key: "active_energy_kcal",  label: "Active Energy",  unit: "kcal", decimals: 0, color: "#ff6b35" },
  { key: "resting_energy_kcal", label: "Resting Energy", unit: "kcal", decimals: 0, color: "#34c759" },
];

const FIXED_DAYS = 180;
const FIXED_BUCKET = 7;

function series(metrics: BodyMetric[], key: MetricKey) {
  return metrics
    .map((m) => ({ date: m.metric_date, value: m[key] as number | null }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

interface ChartPoint {
  date: string;       // representative (middle) date — used for x positioning
  dateStart: string;  // first day covered by this bucket
  dateEnd: string;    // last day covered by this bucket
  value: number;
}

function bucketSeries(
  pts: { date: string; value: number }[],
  bucketDays: number,
): ChartPoint[] {
  if (!pts.length) return [];
  if (bucketDays <= 1) {
    return pts.map((p) => ({ date: p.date, dateStart: p.date, dateEnd: p.date, value: p.value }));
  }

  const MS = 86400000;
  const buckets = new Map<number, { dates: string[]; values: number[] }>();
  for (const p of pts) {
    const dayIndex = Math.floor(new Date(p.date + "T12:00:00").getTime() / (MS * bucketDays));
    if (!buckets.has(dayIndex)) buckets.set(dayIndex, { dates: [], values: [] });
    buckets.get(dayIndex)!.dates.push(p.date);
    buckets.get(dayIndex)!.values.push(p.value);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const { dates, values } = buckets.get(k)!;
      // dates arrive oldest → newest, so [0] / last bound the week
      return {
        date: dates[Math.floor(dates.length / 2)],
        dateStart: dates[0],
        dateEnd: dates[dates.length - 1],
        value: values.reduce((s, v) => s + v, 0) / values.length,
      };
    });
}

function rollingAvg(pts: { date: string; value: number }[], days = 7, offsetDays = 0): number | null {
  if (!pts.length) return null;
  const last = pts.at(-1)!.date;
  const end = new Date(last + "T12:00:00");
  end.setDate(end.getDate() - offsetDays);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const endStr = end.toISOString().slice(0, 10);
  const startStr = start.toISOString().slice(0, 10);
  const window = pts.filter((p) => p.date >= startStr && p.date <= endStr);
  if (!window.length) return null;
  return window.reduce((s, p) => s + p.value, 0) / window.length;
}

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
        <div style={{ height: 80, background: "var(--bg-soft)", borderRadius: 8, opacity: 0.4 }} />
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
            stroke="var(--ink-5, #e5e5ea)"
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

function formatDateRange(pts: { date: string }[]): string {
  if (!pts.length) return "";
  const fmt = (d: string) => {
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  };
  if (pts.length === 1) return fmt(pts[0].date);
  return `${fmt(pts[0].date)} – ${fmt(pts.at(-1)!.date)}`;
}

function AnimatedTdee({ value }: { value: number }) {
  const count = useCountUp(Math.round(value), 700);
  return <>{count.toLocaleString()}</>;
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
      const thisWeek = rollingAvg(s, 7, 0);
      const prevWeek = rollingAvg(s, 7, 7);
      const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
      const bucketed = bucketSeries(s, FIXED_BUCKET);
      const dateRange = formatDateRange(bucketed);
      return { spec, bucketed, thisWeek, change, dateRange, readingCount: s.length };
    });
  }, [data]);

  if (error) {
    return (
      <div className="page">
        <section className="page-card">
          <p className="auth-error">{error}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page health">
      {/* TDEE hero — fixed windows, independent of period selector */}
      <section className="page-card health-tdee">
        <p className="page-eyebrow">CURRENT TDEE</p>
        {!data ? (
          <div className="health-tdee-num">
            <AnimatedTdee value={0} />
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
                </span>
                <span className="health-tdee-component-window">
                  {tdee.restingDays < 30 ? `${tdee.restingDays}-day average` : "30-day average"}
                </span>
              </div>
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Active</span>
                <span className="health-tdee-component-val">
                  {tdee.avgActive?.toLocaleString()} kcal/day
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

      {/* Metric cards — Apple Health style */}
      {cards.map(({ spec, bucketed, thisWeek, change, dateRange, readingCount }) => {
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
              {change != null && readingCount >= 2 && (
                <span className={`health-metric-change${changeCls}`}>
                  {change > 0 ? "+" : ""}{fmt(change, spec.decimals)} {spec.unit}
                </span>
              )}
            </div>

            <p className="health-metric-eyebrow">THIS WEEK</p>
            <div className="health-metric-hero">
              {thisWeek != null ? (
                <>
                  <span className="health-metric-val">{fmt(thisWeek, spec.decimals)}</span>
                  <span className="health-unit">{spec.unit}</span>
                </>
              ) : (
                <span className="health-metric-val health-metric-val--empty">—</span>
              )}
            </div>
            {dateRange && <p className="health-metric-daterange">{dateRange}</p>}

            <LineChart points={bucketed} color={spec.color} decimals={spec.decimals} unit={spec.unit} />
          </section>
        );
      })}
    </div>
  );
}
