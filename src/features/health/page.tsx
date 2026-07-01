import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchHealthData, type HealthData } from "./api";
import {
  series,
  bucketSeries,
  rollingAvg,
  regressionSlope,
  computeRecovery,
  RECOVERY_STATUS_COLOR,
  type MetricKey,
  type ChartPoint,
  type RecoverySnapshot,
} from "./math";
import { ErrorState } from "@shared/components/ErrorState";
import { useCountUp } from "@shared/hooks/useCountUp";
import { TrendIcon } from "@shared/components/TrendIcon";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { buildHealthJson } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
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
}

const METRICS: MetricSpec[] = [
  { key: "weight_kg",    label: "Weight",   unit: "kg", decimals: 1, color: "var(--health-weight)",  bucket: 7,  avgLabel: "7-day average · rate of change" },
  { key: "body_fat_pct", label: "Body Fat", unit: "%",  decimals: 1, color: "var(--health-bodyfat)", bucket: 14, avgLabel: "14-day average" },
];

const FIXED_DAYS = 180;
const copyHealthData = () => buildHealthJson();

/* Small static trend indicator on each Trend card's header — a glance-only
   180-day shape, not a scrubbable chart (that's a deliberate design call,
   not a fidelity cut: the card's own big number + delta already carry the
   "what changed" story). */
function Sparkline({ points, color }: { points: ChartPoint[]; color: string }) {
  const width = 92, height = 40;
  if (points.length < 2) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline" />;

  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p.value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const known = cur != null && prev != null;
  const diff = known ? cur - prev : 0;
  const up = diff > 20, down = diff < -20;
  const dir = up ? "up" : down ? "down" : "flat";
  const color = up ? "var(--good)" : down ? "var(--bad)" : "var(--ink-4)";
  return (
    <span
      className={`health-tdee-component-trend${known ? "" : " health-tdee-component-trend--empty"}`}
      style={{ color }}
    >
      <TrendIcon dir={dir} size={12} />
    </span>
  );
}

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
  const decimals = unit === "h" ? 1 : 0;

  return (
    <div className="health-recovery-row">
      <span className="health-recovery-row-label">{label}</span>
      <div className="health-recovery-row-stat">
        <MetricValue size="md" unit={value != null ? unit : undefined}>
          {value != null ? fmt(value, decimals) : "—"}
        </MetricValue>
        <MetricDelta value={delta} higherBetter={higherBetter} decimals={decimals} />
      </div>
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

  const color = RECOVERY_STATUS_COLOR[snap.status];

  return (
    <section className="page-card health-recovery">
      <div className="health-recovery-head">
        <span className="health-card-eyebrow">Recovery</span>
        <span className="health-recovery-status" style={{ color }}>{snap.status}</span>
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

function TrendCard({
  label,
  avgLabel,
  value,
  unit,
  decimals,
  delta,
  points,
  color,
  loading = false,
}: {
  label: string;
  avgLabel: string;
  value: number | null;
  unit: string;
  decimals: number;
  delta: ReactNode;
  points: ChartPoint[];
  color: string;
  loading?: boolean;
}) {
  return (
    <section className={`page-card health-trend${loading ? " loading-card" : ""}`}>
      <div className="health-trend-head">
        <div className="health-trend-info">
          <span className="health-card-eyebrow">{label}</span>
          <div className="health-trend-stat">
            {loading ? (
              <MetricValue size="md" unit={unit}>00.0</MetricValue>
            ) : value != null ? (
              <MetricValue size="md" unit={unit} style={{ color }}>
                <AnimatedMetric value={value} decimals={decimals} />
              </MetricValue>
            ) : (
              <MetricValue size="md" className="health-metric-val--empty">—</MetricValue>
            )}
            {delta}
          </div>
          <MetricCaption>{loading ? "Loading" : avgLabel}</MetricCaption>
        </div>
        <Sparkline points={points} color={color} />
      </div>
      <div className="health-trend-range">{FIXED_DAYS}-day trend</div>
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

  usePageHeader({ eyebrow: "HEALTH", title: "Trends", onCopy: copyHealthData });

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="page health">
      {recovery && <RecoveryCard snap={recovery} />}

      {/* Trend card skeleton — same TrendCard component, placeholder values,
          so height matches the loaded Weight / Body Fat / Lean Mass cards. */}
      {!data && METRICS.map((spec) => (
        <TrendCard
          key={spec.key}
          loading
          label={spec.label}
          avgLabel={spec.avgLabel}
          value={0}
          unit={spec.unit}
          decimals={spec.decimals}
          color={spec.color}
          points={[]}
          delta={null}
        />
      ))}
      {!data && (
        <TrendCard
          loading
          label="Lean Mass"
          avgLabel="14-day average · derived"
          value={0}
          unit="kg"
          decimals={1}
          color="var(--health-leanmass)"
          points={[]}
          delta={null}
        />
      )}

      {/* Trend cards — Weight, Body Fat */}
      {cards.map(({ spec, bucketed, thisWeek, change, readingCount }) => (
        <TrendCard
          key={spec.key}
          label={spec.label}
          avgLabel={spec.avgLabel}
          value={thisWeek}
          unit={spec.unit}
          decimals={spec.decimals}
          color={spec.color}
          points={bucketed}
          delta={
            spec.key === "weight_kg" && weightPace != null ? (
              // Pace is shown neutral (grey) — a rate, not a good/bad verdict.
              <MetricDelta value={weightPace} decimals={2} unit="kg/wk" />
            ) : change != null && readingCount >= 2 ? (
              // Body fat (and any future loss-is-good metric): down = green.
              <MetricDelta
                value={change}
                higherBetter={spec.key === "body_fat_pct" ? false : undefined}
                decimals={spec.decimals}
                unit={spec.unit}
              />
            ) : null
          }
        />
      ))}

      {/* Lean Mass card — derived from weight × (1 - body_fat%) */}
      {lbmCard && (
        <TrendCard
          label="Lean Mass"
          avgLabel="14-day average · derived"
          value={lbmCard.thisWeek}
          unit="kg"
          decimals={1}
          color="var(--health-leanmass)"
          points={lbmCard.bucketed}
          delta={
            lbmCard.change != null && lbmCard.readingCount >= 2 ? (
              <MetricDelta value={lbmCard.change} higherBetter decimals={1} unit="kg" />
            ) : null
          }
        />
      )}

      {/* TDEE — a derived metabolic estimate, so it sits last, after the body-
          state cards (Recovery / Weight / Body Fat / Lean Mass). Fixed windows,
          independent of any period selector. */}
      <section className={`page-card health-tdee${!data ? " loading-card" : ""}`}>
        <span className="health-card-eyebrow">TDEE</span>
        {!data ? (
          <>
            <div className="health-tdee-num">
              <MetricValue size="md" unit="kcal">0000</MetricValue>
            </div>
            <div className="health-tdee-components">
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Resting</span>
                <MetricValue size="sm" unit="kcal">0000</MetricValue>
                <span className="health-tdee-component-window">30-day average</span>
              </div>
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Active</span>
                <MetricValue size="sm" unit="kcal">000</MetricValue>
                <span className="health-tdee-component-window">14-day average</span>
              </div>
            </div>
          </>
        ) : tdee?.tdee != null ? (
          <>
            <div className="health-tdee-num">
              <MetricValue size="md" unit="kcal">
                <AnimatedTdee value={tdee.tdee} />
              </MetricValue>
              {tdeePrev?.tdee != null && (
                // higherBetter — a rising TDEE reads green here by design choice,
                // matching the Overview TDEE stat; not an objective "good".
                <MetricDelta value={tdee.tdee - tdeePrev.tdee} higherBetter threshold={40} />
              )}
            </div>
            <div className="health-tdee-components">
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">
                  <ComponentTrend cur={tdee.avgResting} prev={tdeePrev?.avgResting} />
                  Resting
                </span>
                <MetricValue size="sm" unit="kcal">{tdee.avgResting?.toLocaleString()}</MetricValue>
                <span className="health-tdee-component-window">
                  {tdee.restingDays < 30 ? `${tdee.restingDays}-day average` : "30-day average"}
                </span>
              </div>
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">
                  <ComponentTrend cur={tdee.avgActive} prev={tdeePrev?.avgActive} />
                  Active
                </span>
                <MetricValue size="sm" unit="kcal">{tdee.avgActive?.toLocaleString()}</MetricValue>
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
    </div>
  );
}
