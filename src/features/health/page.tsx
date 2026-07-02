import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchHealthData, type HealthData } from "./api";
import {
  series,
  bucketSeries,
  rollingAvg,
  computeRecovery,
  sanitizeMetrics,
  countSkippedBodyFat,
  RECOVERY_STATUS_COLOR,
  type MetricKey,
  type ChartPoint,
  type RecoverySnapshot,
} from "./math";
import { ErrorState } from "@shared/components/ErrorState";
import { useCountUp } from "@shared/hooks/useCountUp";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { buildHealthJson } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { localDateStr } from "@shared/lib/date";
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
  { key: "weight_kg",    label: "Weight",   unit: "kg", decimals: 1, color: "var(--health-weight)",  bucket: 7,  avgLabel: "7-day average", minSpan: 3 },
  { key: "body_fat_pct", label: "Body Fat", unit: "%",  decimals: 1, color: "var(--health-bodyfat)", bucket: 14, avgLabel: "14-day average", minSpan: 3 },
];

const FIXED_DAYS = 180;
const copyHealthData = () => buildHealthJson();

// Sparkline range follows the card's own averaging window: each bead IS that
// window's average (7-day bucket for Weight, 14-day for Body Fat/Lean Mass),
// so a bead's position means something instead of landing on an arbitrary
// slice. Fixed at 6 beads — the range is however many days that spans
// (Weight → 42d/6wk, Body Fat/Lean Mass → 84d/12wk).
const SPARK_POINTS = 6;

/* Small static trend indicator on each Trend card's header — a glance-only
   shape (range = its own bucket × SPARK_POINTS), not a scrubbable chart
   (that's a deliberate design call, not a fidelity cut: the card's own big
   number + delta already carry the "what changed" story). */
function Sparkline({ points, minSpan = 0 }: { points: ChartPoint[]; minSpan?: number }) {
  const width = 92, height = 40;
  if (points.length < 2) return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline" />;

  const vals = points.map((p) => p.value);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  // Widen the domain to minSpan around the data's own center rather than
  // shrinking to whatever the actual range is — a flat week and a real move
  // stay visually distinguishable instead of both filling the chart height.
  const dataSpan = dataMax - dataMin;
  const center = (dataMax + dataMin) / 2;
  const halfSpan = Math.max(dataSpan, minSpan) / 2;
  const min = center - halfSpan;
  const span = halfSpan * 2 || 1;
  // Inset the plot by the endpoint dot's radius so the "you are here" marker
  // sits fully inside the viewBox instead of poking past the right edge.
  const dot = 3;
  const coords = points.map((p, i) => {
    const x = dot + (i / (points.length - 1)) * (width - dot * 2);
    const y = height - dot - ((p.value - min) / span) * (height - dot * 2);
    return { x, y };
  });
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  // Apple-style: the line recedes to grey; each reading is a hollow grey bead
  // threaded on it (fill masks the line to read as open). Every bead is the same
  // size — only the latest is ringed in the metric colour, the "you are here"
  // anchor. SPARK_POINTS keeps the beads from crowding.
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
      <polyline points={pts} fill="none" stroke="var(--ink-4)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {coords.slice(0, -1).map((c, i) => (
        <circle key={i} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r={dot} fill="var(--bg-card)" stroke="var(--ink-4)" strokeWidth="2" />
      ))}
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={dot} fill="var(--bg-card)" stroke="var(--health-bodyfat)" strokeWidth="2" />
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

function RecoveryRow({
  label,
  value,
  unit,
  delta,
  direction,
}: {
  label: string;
  value: number | null;
  unit: string;
  delta: number | null;
  direction: "up-good" | "down-good";
}) {
  const decimals = unit === "h" ? 1 : 0;

  return (
    <div className="health-recovery-row">
      <span className="health-recovery-row-label">{label}</span>
      <div className="health-recovery-row-stat">
        <MetricValue size="md" unit={value != null ? unit : undefined}>
          {value != null ? fmt(value, decimals) : "—"}
        </MetricValue>
        <MetricDelta value={delta} direction={direction} decimals={decimals} />
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
        <RecoveryRow label="Sleep" value={snap.sleepHours} unit="h"   delta={sleepDelta} direction="up-good" />
        <RecoveryRow label="HRV"   value={snap.hrv}        unit="ms"  delta={hrvDelta}   direction="up-good" />
        <RecoveryRow label="RHR"   value={snap.rhr}        unit="bpm" delta={rhrDelta}   direction="down-good" />
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
  loading = false,
  note,
  minSpan = 0,
  rangeDays,
}: {
  label: string;
  avgLabel: string;
  value: number | null;
  unit: string;
  decimals: number;
  delta: ReactNode;
  points: ChartPoint[];
  loading?: boolean;
  /** Data-quality caveat for this card only — e.g. samples ignored as
      implausible. Rendered under the range line, not shimmer'd. */
  note?: string;
  /** Sparkline y-domain floor, in this metric's own unit. */
  minSpan?: number;
  /** Sparkline span in days — bucketDays × SPARK_POINTS, not a fixed 180. */
  rangeDays: number;
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
              <MetricValue size="md" unit={unit}>
                <AnimatedMetric value={value} decimals={decimals} />
              </MetricValue>
            ) : (
              <MetricValue size="md" className="health-metric-val--empty">—</MetricValue>
            )}
            {delta}
          </div>
        </div>
        <Sparkline points={points} minSpan={minSpan} />
      </div>
      <div className="health-trend-foot">
        <MetricCaption>{loading ? "Loading" : avgLabel}</MetricCaption>
        <div className="health-trend-range">{rangeDays}-day trend</div>
      </div>
      {!loading && note && <p className="health-trend-note">{note}</p>}
    </section>
  );
}

// Body-fat plausibility filtering (isImplausibleBodyFat / sanitizeMetrics /
// countSkippedBodyFat) now lives in ./math so the AI export applies the exact
// same filter — a sample that never reaches a chart must never reach the export.

// A metric that's quietly N days stale reads as confidently current unless
// something says otherwise — every card anchors on the latest reading, so a
// sync gap silently shifts what "this period" means.
const STALE_AFTER_DAYS = 3;

function syncLabel(latestDate: string | null): { text: string; stale: boolean } | null {
  if (!latestDate) return null;
  const daysAgo = Math.round((Date.parse(localDateStr()) - Date.parse(latestDate)) / 86400000);
  const text =
    daysAgo <= 0 ? "Synced today"
    : daysAgo === 1 ? "Synced yesterday"
    : `Synced ${daysAgo} days ago`;
  return { text, stale: daysAgo > STALE_AFTER_DAYS };
}

export function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activity = useTabActivity();

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
  const lastSynced = useMemo(
    () => syncLabel(metrics.at(-1)?.metric_date ?? null),
    [metrics],
  );
  const skippedBodyFatCount = useMemo(
    () => (data ? countSkippedBodyFat(data.metrics) : 0),
    [data],
  );

  const tdee = data?.tdee;
  const tdeePrev = data?.tdeePrev;
  // Component-level change vs the previous window (active 14→28d, resting 30→60d).
  // Both carry a coloured up-good delta: more Active energy = you moved more, and
  // a higher Resting rate = less metabolic adaptation — both read as up = good.
  const activeChange =
    tdee?.avgActive != null && tdeePrev?.avgActive != null
      ? tdee.avgActive - tdeePrev.avgActive
      : null;
  const restingChange =
    tdee?.avgResting != null && tdeePrev?.avgResting != null
      ? tdee.avgResting - tdeePrev.avgResting
      : null;

  const cards = useMemo(() => {
    if (!data) return [];
    return METRICS.map((spec) => {
      const s = series(metrics, spec.key);
      const thisWeek = rollingAvg(s, spec.bucket, 0);
      const prevWeek = rollingAvg(s, spec.bucket, spec.bucket);
      const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
      const bucketed = bucketSeries(s, { spanDays: spec.bucket * SPARK_POINTS, bucketDays: spec.bucket });
      return { spec, bucketed, thisWeek, change, readingCount: s.length };
    });
  }, [data, metrics]);

  const recovery = useMemo(() => {
    if (!data) return null;
    return computeRecovery(metrics);
  }, [data, metrics]);

  const lbmCard = useMemo(() => {
    if (!data) return null;
    const pts = metrics
      .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
      .map((m) => ({
        date: m.metric_date,
        value: m.weight_kg! * (1 - m.body_fat_pct! / 100),
      }));
    if (!pts.length) return null;
    const thisWeek = rollingAvg(pts, 14, 0);
    const prevWeek = rollingAvg(pts, 14, 14);
    const change = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;
    const lbmBucket = 14;
    const bucketed = bucketSeries(pts, { spanDays: lbmBucket * SPARK_POINTS, bucketDays: lbmBucket });
    return { thisWeek, change, bucketed, readingCount: pts.length, rangeDays: lbmBucket * SPARK_POINTS };
  }, [data, metrics]);

  usePageHeader({ eyebrow: "HEALTH", title: "Trends", onCopy: copyHealthData });

  if (error && !data) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="page health">
      {/* TDEE — the metabolic anchor for the whole tab, so it leads. The total
          stays uncoloured (a rising estimate isn't an "outcome"), but both
          components carry an up-good coloured delta vs the previous window
          (Active = did you move enough; Resting = higher rate is less metabolic
          adaptation). */}
      <section className={`page-card health-tdee${!data ? " loading-card" : ""}`}>
        <div className="health-tdee-head">
          <span className="health-card-eyebrow">TDEE</span>
          {lastSynced && (
            <span className={`health-sync-note${lastSynced.stale ? " is-stale" : ""}`}>
              {lastSynced.text}
            </span>
          )}
        </div>
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
            </div>
            <div className="health-tdee-components">
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Resting</span>
                <div className="health-tdee-component-stat">
                  <MetricValue size="sm" unit="kcal">{tdee.avgResting?.toLocaleString()}</MetricValue>
                  {restingChange != null && (
                    <MetricDelta value={restingChange} direction="up-good" decimals={0} />
                  )}
                </div>
                <span className="health-tdee-component-window">
                  {tdee.restingDays < 30 ? `${tdee.restingDays}-day average` : "30-day average"}
                </span>
              </div>
              <div className="health-tdee-component">
                <span className="health-tdee-component-label">Active</span>
                <div className="health-tdee-component-stat">
                  <MetricValue size="sm" unit="kcal">{tdee.avgActive?.toLocaleString()}</MetricValue>
                  {activeChange != null && (
                    <MetricDelta value={activeChange} direction="up-good" decimals={0} />
                  )}
                </div>
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
          points={[]}
          delta={null}
          rangeDays={spec.bucket * SPARK_POINTS}
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
          points={[]}
          delta={null}
          rangeDays={14 * SPARK_POINTS}
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
          points={bucketed}
          minSpan={spec.minSpan}
          rangeDays={spec.bucket * SPARK_POINTS}
          delta={
            // Both Weight and Body Fat are down-good on a cut — this page is the
            // body-composition trend view, so each carries its own coloured
            // delta (the smoothed rolling average, not a single noisy day; the
            // threshold still suppresses changes within noise). Overview's weight
            // card stays delta-free because its pace/Status read covers it there.
            change != null && readingCount >= 2 ? (
              <MetricDelta value={change} direction="down-good" decimals={spec.decimals} unit={spec.unit} />
            ) : null
          }
          note={
            spec.key === "body_fat_pct" && skippedBodyFatCount > 0
              ? `Skipped ${skippedBodyFatCount} invalid body fat sample${skippedBodyFatCount === 1 ? "" : "s"}`
              : undefined
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
          points={lbmCard.bucketed}
          minSpan={2}
          rangeDays={lbmCard.rangeDays}
          delta={
            lbmCard.change != null && lbmCard.readingCount >= 2 ? (
              <MetricDelta value={lbmCard.change} direction="up-good" decimals={1} unit="kg" />
            ) : null
          }
        />
      )}

      {/* Recovery — sleep / HRV / RHR readiness snapshot. Sits last: it's a
          day-to-day state read, below the longer-arc body-composition and TDEE
          cards. */}
      {recovery && <RecoveryCard snap={recovery} />}
    </div>
  );
}
