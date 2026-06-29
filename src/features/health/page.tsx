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
}

const METRICS: MetricSpec[] = [
  { key: "weight_kg", label: "Weight", unit: "kg", decimals: 1 },
  { key: "body_fat_pct", label: "Body Fat", unit: "%", decimals: 1 },
  { key: "active_energy_kcal", label: "Active Energy", unit: "kcal", decimals: 0 },
  { key: "resting_energy_kcal", label: "Resting Energy", unit: "kcal", decimals: 0 },
];

type RangeKey = "30D" | "90D" | "6M" | "1Y";
const RANGES: { key: RangeKey; days: number }[] = [
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
];

function series(metrics: BodyMetric[], key: MetricKey) {
  return metrics
    .map((m) => ({ date: m.metric_date, value: m[key] as number | null }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

/** Rolling N-day average ending at the last point in `pts`. */
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

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark spark--empty" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });


function AnimatedTdee({ value }: { value: number }) {
  const display = useAnimatedNumber(value);
  return <>{display}</>;
}

export function HealthPage() {
  const [range, setRange] = useState<RangeKey>("6M");
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = RANGES.find((r) => r.key === range)!.days;

  useEffect(() => {
    setData(null);
    fetchHealthData(days)
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [days]);

  useCopyButton(buildAllDataJson);

  const tdee = data?.tdee;

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(data.metrics, spec.key);
      const avg7d = rollingAvg(s);
      const first = s[0];
      const latest = s.at(-1);
      const change = latest && first ? latest.value - first.value : null;
      return { spec, values: s.map((p) => p.value), avg7d, latest, change };
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
      {/* Range selector */}
      <div className="health-range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`health-range-btn${range === r.key ? " health-range-btn--active" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.key}
          </button>
        ))}
      </div>

      {/* TDEE from Apple Health */}
      <section className="page-card health-tdee">
        <p className="page-eyebrow">TDEE · 30d resting + 14d active avg</p>
        {!data ? (
          <p className="page-note">Loading…</p>
        ) : tdee?.tdee != null ? (
          <>
            <div className="health-tdee-num">
              <AnimatedTdee value={tdee.tdee} />
              <span className="health-unit">kcal/day</span>
            </div>
            <div className="health-tdee-grid">
              <div>
                <span className="health-k">Resting</span>
                <span className="health-v">{tdee.avgResting?.toLocaleString()} kcal</span>
              </div>
              <div>
                <span className="health-k">Active</span>
                <span className="health-v">{tdee.avgActive?.toLocaleString()} kcal</span>
              </div>
              <div>
                <span className="health-k">Resting window</span>
                <span className="health-v">{tdee.restingDays} days</span>
              </div>
              <div>
                <span className="health-k">Active window</span>
                <span className="health-v">{tdee.activeDays} days</span>
              </div>
            </div>
          </>
        ) : (
          <p className="page-note">
            No Apple Health data yet. Make sure the iOS Shortcut has synced at least one day.
          </p>
        )}
      </section>

      {/* Metric history cards */}
      {cards.map(({ spec, values, avg7d, change }) => (
        <section className="page-card health-metric" key={spec.key}>
          <div className="health-metric-head">
            <span className="health-metric-label">{spec.label}</span>
            {avg7d != null ? (
              <span className="health-metric-val">
                {fmt(avg7d, spec.decimals)}
                <span className="health-unit"> {spec.unit}</span>
              </span>
            ) : (
              <span className="health-metric-val health-metric-val--empty">—</span>
            )}
          </div>
          {avg7d != null && (
            <p className="health-metric-avg-label">7-day avg</p>
          )}
          <Sparkline values={values} />
          {change != null && values.length >= 2 && (
            <p className="health-metric-change">
              {change > 0 ? "+" : ""}
              {fmt(change, spec.decimals)} {spec.unit} over {values.length} readings
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
