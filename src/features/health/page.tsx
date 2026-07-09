import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { fetchHealthData, type HealthData } from "./api";
import {
  series,
  bucketSeries,
  rollingAvg,
  computeRecovery,
  sanitizeMetrics,
  countSkippedBodyFat,
  latestUpdatedAt,
  RECOVERY_STATUS_COLOR,
  type MetricKey,
  type ChartPoint,
  type RecoverySnapshot,
} from "./math";
import { type MetricKind } from "@shared/lib/freshness";
import { FreshnessTag } from "@shared/components/FreshnessTag";
import { ErrorState } from "@shared/components/ErrorState";
import { AnimatedNumber } from "@shared/components/AnimatedNumber";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { PageTopBar } from "@shared/components/PageTopBar";
import { buildHealthJson } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
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
// Active-energy sparkline: 14-day buckets (matches Body Fat / Lean Mass), and a
// kcal min-span so a small week-to-week wobble doesn't fill the whole chart.
const ENERGY_BUCKET = 14;
const ENERGY_MIN_SPAN = 200;
const copyHealthData = () => buildHealthJson();

// Sparkline range follows the card's own averaging window: each bead IS that
// window's average (7-day bucket for Weight, 14-day for Body Fat/Lean Mass),
// so a bead's position means something instead of landing on an arbitrary
// slice. Fixed at 6 beads — the range is however many days that spans
// (Weight → 42d/6wk, Body Fat/Lean Mass → 84d/12wk).
const SPARK_POINTS = 6;

/* Trend indicator on each Trend card's header (range = its own bucket ×
   SPARK_POINTS) — a glance-only shape. Tapping it opens the big trend sheet
   (all readings, scrubbable); that tap is its own button with stopPropagation
   so it never fights the card's own tap (e.g. Active's Resting/TDEE reveal). */
function Sparkline({
  points,
  minSpan = 0,
  color = "var(--health-measurement)",
  onOpen,
}: {
  points: ChartPoint[];
  minSpan?: number;
  color?: string;
  onOpen?: () => void;
}) {
  const width = 130, height = 44;

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
  const dot = 2.2;
  // The anchor ("you are here") bead reads slightly larger than the history
  // beads it's threaded among — the size bump is itself part of the signal,
  // not just the colour ring.
  const anchorDot = 4;
  const coords = points.map((p, i) => {
    const x = dot + (i / (points.length - 1)) * (width - dot * 2);
    const y = height - dot - ((p.value - min) / span) * (height - dot * 2);
    return { x, y };
  });
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const n = coords.length;

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Apple-style: the line recedes to grey; each reading is a hollow grey bead
  // threaded on it (fill masks the line to read as open). Every bead is the same
  // size — only the latest is ringed in the metric colour, the "you are here"
  // anchor. SPARK_POINTS keeps the beads from crowding.
  const svg = reduced ? (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
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
      const tierDelay = "calc(var(--stagger-step) * var(--enter-tier, 0) * 3 + var(--enter-wait))";
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="health-sparkline">
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

  if (!onOpen) return <div className="health-sparkline-wrap">{svg}</div>;

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
        {svg}
      </button>
    </div>
  );
}

const fmt = (v: number, d: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* Hero metric number — counts up, staggered bottom-up by its on-screen position
   (see AnimatedNumber); a same-visit value settle tweens without blanking. */
function AnimatedMetric({ value, decimals }: { value: number; decimals: number }) {
  return <AnimatedNumber value={value} decimals={decimals} format={(n) => fmt(n, decimals)} />;
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
          {value != null ? <AnimatedMetric value={value} decimals={decimals} /> : "—"}
        </MetricValue>
        <MetricDelta value={delta} direction={direction} decimals={decimals} />
      </div>
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
              <div className="health-recovery-row-stat">
                <MetricValue size="md" unit={r.unit}>{r.value}</MetricValue>
              </div>
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
        <span className="health-recovery-head-right">
          <span className="health-recovery-status" style={{ color }}>{snap.status}</span>
          <FreshnessTag date={snap.date} kind="recovery" updatedAt={snap.updatedAt} />
        </span>
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
  color,
  onOpenTrend,
  freshnessKind,
  syncDate,
  updatedAt,
}: {
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
  /** Tapping the sparkline (only) opens the big scrubbable trend sheet. */
  onOpenTrend?: () => void;
}) {
  return (
    <section className={`page-card health-trend${loading ? " loading-card" : ""}`}>
      <div className="health-card-top">
        <span className="health-card-eyebrow">{label}</span>
        {!loading && <FreshnessTag date={syncDate} kind={freshnessKind} updatedAt={updatedAt} />}
      </div>
      <div className="health-trend-head">
        <div className="health-trend-info">
          <div className="health-trend-stat">
            {loading ? (
              <MetricValue size="lg" unit={unit}>00.0</MetricValue>
            ) : value != null ? (
              <MetricValue size="lg" unit={unit}>
                <AnimatedMetric value={value} decimals={decimals} />
              </MetricValue>
            ) : (
              <MetricValue size="lg" className="health-metric-val--empty">—</MetricValue>
            )}
            {delta}
          </div>
        </div>
        <Sparkline points={points} minSpan={minSpan} color={color} onOpen={onOpenTrend} />
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

  // Active-energy sparkline — Active is the one behaviour-driven, trend-worthy
  // number in the Energy card, so it gets the same 14-day bucket / 84-day trend
  // shape as Body Fat and Lean Mass. Resting + TDEE ride along as model context.
  const energyRaw = useMemo(() => series(metrics, "active_energy_kcal"), [metrics]);
  const energyBucketed = useMemo(() => {
    if (!data) return [];
    return bucketSeries(energyRaw, { spanDays: ENERGY_BUCKET * SPARK_POINTS, bucketDays: ENERGY_BUCKET });
  }, [data, energyRaw]);
  const energyFull = useMemo(
    () => bucketSeries(energyRaw, { spanDays: FIXED_DAYS, bucketDays: ENERGY_BUCKET }),
    [energyRaw],
  );

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
                ? () => openTrend({ label: spec.label, unit: spec.unit, decimals: spec.decimals, color: spec.color, points: c.full, higherIsBetter: false, bucketDays: spec.bucket })
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
              {lbmCard.change > 0 ? "+" : "−"}
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
          trend (behaviour-driven); Resting + TDEE ride below as context so
          Resting + Active = TDEE still adds up. */}
      <section
        id="health-energy-card"
        className={`page-card health-energy${!data ? " loading-card" : ""}`}
        {...(data && tdee?.tdee != null
          ? {
              role: "button" as const,
              tabIndex: 0,
              "aria-expanded": energyExpanded,
              onClick: () => setEnergyExpanded((v) => !v),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
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
              <Sparkline points={[]} minSpan={ENERGY_MIN_SPAN} color="var(--accent)" />
            </div>
            <div className="health-trend-foot">
              <MetricCaption>Loading…</MetricCaption>
              <div className="health-trend-range">{ENERGY_BUCKET * SPARK_POINTS}-day trend</div>
            </div>
          </>
        ) : tdee?.tdee != null ? (
          <>
            {/* Active leads with the sparkline — the behaviour-driven number. */}
            <div className="health-trend-head">
              <div className="health-trend-info">
                <div className="health-trend-stat">
                  <MetricValue size="lg" unit="kcal">
                    {tdee.avgActive != null ? <AnimatedMetric value={tdee.avgActive} decimals={0} /> : null}
                  </MetricValue>
                  {activeChange != null && (
                    <MetricDelta value={activeChange} direction="up-good" decimals={0} />
                  )}
                </div>
              </div>
              <Sparkline
                points={energyBucketed}
                minSpan={ENERGY_MIN_SPAN}
                color="var(--accent)"
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
              <div className="health-trend-range">{ENERGY_BUCKET * SPARK_POINTS}-day trend</div>
            </div>

            {/* Resting + TDEE — the model behind the ring, revealed on tapping the
                card, so Resting + Active = TDEE still visibly adds up. Always
                mounted (not conditionally rendered) so the grid-rows collapse
                can animate instead of the content just vanishing. */}
            <div className={`health-energy-model-wrap${energyExpanded ? " is-open" : ""}`}>
              <div className="health-energy-model">
                <div className="health-energy-model-item">
                  <span className="health-energy-metric-label">Resting</span>
                  <div className="health-trend-stat">
                    <MetricValue size="sm" unit="kcal">
                      {tdee.avgResting != null ? <AnimatedMetric value={tdee.avgResting} decimals={0} /> : null}
                    </MetricValue>
                  </div>
                  <span className="health-energy-window">
                    {/* Fixed descriptor of the trailing window, not the sample
                        count — a missing day shouldn't tick it to "29". */}
                    30-day average
                  </span>
                </div>
                <div className="health-energy-model-item">
                  <span className="health-energy-metric-label">TDEE</span>
                  <MetricValue size="sm" unit="kcal">
                    <AnimatedMetric value={tdee.tdee} decimals={0} />
                  </MetricValue>
                  <span className="health-energy-window">resting + active</span>
                </div>
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
