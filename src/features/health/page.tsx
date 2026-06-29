import { useEffect, useMemo, useState } from "react";
import { fetchHealthData, type BodyMetric, type HealthData } from "./api";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { buildAllDataJson } from "@shared/lib/copyAllData";
import { useAnimatedNumber } from "@shared/hooks/useAnimatedNumber";
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

type RangeKey = "30D" | "90D" | "6M" | "1Y";
const RANGES: { key: RangeKey; label: string; days: number; bucketDays: number }[] = [
  { key: "30D", label: "30D", days: 30,  bucketDays: 1  },
  { key: "90D", label: "90D", days: 90,  bucketDays: 3  },
  { key: "6M",  label: "6M",  days: 180, bucketDays: 7  },
  { key: "1Y",  label: "1Y",  days: 365, bucketDays: 30 },
];

function series(metrics: BodyMetric[], key: MetricKey) {
  return metrics
    .map((m) => ({ date: m.metric_date, value: m[key] as number | null }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

function bucketSeries(
  pts: { date: string; value: number }[],
  bucketDays: number,
): { date: string; value: number }[] {
  if (!pts.length) return [];
  if (bucketDays <= 1) return pts;

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
      return {
        date: dates[Math.floor(dates.length / 2)],
        value: values.reduce((s, v) => s + v, 0) / values.length,
      };
    });
}

function rollingAvg(pts: { date: string; value: number }[], days = 7): number | null {
  if (!pts.length) return null;
  const last = pts.at(-1)!.date;
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const window = pts.filter((p) => p.date >= cutoffStr);
  if (!window.length) return null;
  return window.reduce((s, p) => s + p.value, 0) / window.length;
}

const MONTH_ABBR = ["J","F","M","A","M","J","J","A","S","O","N","D"];

function LineChart({ points, color }: { points: { date: string; value: number }[]; color: string }) {
  if (points.length < 2) {
    return (
      <div className="health-chart-wrap">
        <div style={{ height: 80, background: "var(--bg-soft)", borderRadius: 8, opacity: 0.4 }} />
      </div>
    );
  }

  const W = 320;
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

  return (
    <div className="health-chart-wrap">
      <svg
        className="health-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
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

        {/* Data point circles */}
        {points.map((p, i) => (
          <circle key={i} cx={toX(i)} cy={toY(p.value)} r="2.5" fill={color} />
        ))}

        {/* X-axis labels */}
        {tickIndices.map((i) => {
          const d = new Date(points[i].date + "T12:00:00");
          const label = MONTH_ABBR[d.getMonth()];
          return (
            <text
              key={i}
              x={toX(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize="8"
              fill="var(--ink-4)"
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
  const display = useAnimatedNumber(value);
  return <>{display}</>;
}

export function HealthPage() {
  const [range, setRange] = useState<RangeKey>("6M");
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { days, bucketDays } = RANGES.find((r) => r.key === range)!;

  useEffect(() => {
    setData(null);
    fetchHealthData(days)
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [days]);

  useCopyButton(() => buildAllDataJson(days));

  const tdee = data?.tdee;

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(data.metrics, spec.key);
      const avg7d = rollingAvg(s);
      const bucketed = bucketSeries(s, bucketDays);
      const first = bucketed[0];
      const latest = bucketed.at(-1);
      const change = latest && first ? latest.value - first.value : null;
      const dateRange = formatDateRange(bucketed);
      return { spec, bucketed, avg7d, change, dateRange, readingCount: s.length };
    });
  }, [data, bucketDays]);

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
      <section className={`page-card health-tdee${!data ? " loading-card" : ""}`}>
        <p className="page-eyebrow">CURRENT TDEE</p>
        {!data ? (
          <>
            <div className="health-tdee-num">
              <span className="health-tdee-val">0,000</span>
              <span className="health-unit"> kcal/day</span>
            </div>
            <details className="health-tdee-method">
              <summary>
                Calculated from<br />
                30-day Resting Avg + 14-day Active Avg
              </summary>
            </details>
          </>
        ) : tdee?.tdee != null ? (
          <>
            <div className="health-tdee-num">
              <AnimatedTdee value={tdee.tdee} />
              <span className="health-unit"> kcal/day</span>
            </div>
            <details className="health-tdee-method">
              <summary>
                Calculated from<br />
                30-day Resting Avg + 14-day Active Avg
              </summary>
              <hr className="health-tdee-divider" />
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
            </details>
          </>
        ) : (
          <p className="page-note">
            No Apple Health data yet. Make sure the iOS Shortcut has synced at least one day.
          </p>
        )}
      </section>

      {/* Range selector — Apple Health segmented pill */}
      <div className="health-range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`health-range-btn${range === r.key ? " health-range-btn--active" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Skeleton metric cards — shown while data loads */}
      {!data && METRICS.map((spec) => (
        <section key={spec.key} className="page-card health-metric loading-card">
          <div className="health-metric-head">
            <span className="health-metric-label">{spec.label}</span>
            <span className="health-metric-change">+0.0 {spec.unit}</span>
          </div>
          <p className="health-metric-eyebrow">AVERAGE</p>
          <div className="health-metric-hero">
            <span className="health-metric-val">0.0</span>
            <span className="health-unit">{spec.unit}</span>
          </div>
          <p className="health-metric-daterange">Jan 2026 – Jun 2026</p>
          <div className="health-chart-wrap">
            <div className="skel" style={{ height: 80, marginTop: 8, borderRadius: 4 }} />
          </div>
        </section>
      ))}

      {/* Metric cards — Apple Health style */}
      {cards.map(({ spec, bucketed, avg7d, change, dateRange, readingCount }) => {
        const changePositive = change != null && change > 0;
        const changeNegative = change != null && change < 0;
        // For body fat/weight, down is good; for energy, up is neutral
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

            <p className="health-metric-eyebrow">AVERAGE</p>
            <div className="health-metric-hero">
              {avg7d != null ? (
                <>
                  <span className="health-metric-val">{fmt(avg7d, spec.decimals)}</span>
                  <span className="health-unit">{spec.unit}</span>
                </>
              ) : (
                <span className="health-metric-val health-metric-val--empty">—</span>
              )}
            </div>
            {dateRange && <p className="health-metric-daterange">{dateRange}</p>}

            <LineChart points={bucketed} color={spec.color} />
          </section>
        );
      })}
    </div>
  );
}
