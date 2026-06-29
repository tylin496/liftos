import { useEffect, useMemo, useState } from "react";
import { fetchHealthData, type BodyMetric, type HealthData } from "./api";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { buildAllDataJson } from "@shared/lib/copyAllData";
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

function series(metrics: BodyMetric[], key: MetricKey) {
  return metrics
    .map((m) => ({ date: m.metric_date, value: m[key] as number | null }))
    .filter((p): p is { date: string; value: number } => p.value != null);
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


export function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealthData(30)
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useCopyButton(buildAllDataJson);

  const tdee = data?.tdee;

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(data.metrics, spec.key);
      const latest = s.at(-1);
      const first = s[0];
      const change = latest && first ? latest.value - first.value : null;
      return { spec, values: s.map((p) => p.value), latest, change };
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

  if (!data) {
    return (
      <div className="page">
        <section className="page-card">
          <p className="page-note">Loading…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page health">
      {/* TDEE from Apple Health */}
      <section className="page-card health-tdee">
        <p className="page-eyebrow">TDEE · avg last 30 days</p>
        {tdee?.tdee != null ? (
          <>
            <div className="health-tdee-num">
              {tdee.tdee.toLocaleString()}
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
                <span className="health-k">Based on</span>
                <span className="health-v">{tdee.dataPoints} days</span>
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
      {cards.map(({ spec, values, latest, change }) => (
        <section className="page-card health-metric" key={spec.key}>
          <div className="health-metric-head">
            <span className="health-metric-label">{spec.label}</span>
            {latest ? (
              <span className="health-metric-val">
                {fmt(latest.value, spec.decimals)}
                <span className="health-unit"> {spec.unit}</span>
              </span>
            ) : (
              <span className="health-metric-val health-metric-val--empty">—</span>
            )}
          </div>
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
