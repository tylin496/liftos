import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchHealthData, saveTargetTdee, type HealthData } from "./api";
import type { ActiveTargetView } from "./activeTarget";
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
import { useToast } from "@shared/components/Toast";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ActivityRing } from "@shared/components/ActivityRing";
import "@shared/components/activityRing.css";
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

/* Active Target — back-solves the daily active-calorie goal from a maintenance
   TDEE target (target − resting), then tracks this week's pace against it. The
   whole card is derived from the latest synced metrics, so it re-computes on
   every sync without any stored state. Tap the target chip to edit the goal. */
function ActiveTargetCard({
  view,
  targetTdee,
  onSave,
}: {
  view: ActiveTargetView | null;
  targetTdee: number | null;
  onSave: (next: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function beginEdit() {
    setDraft(targetTdee != null ? String(targetTdee) : "");
    setEditing(true);
  }
  async function commit() {
    const n = parseInt(draft, 10);
    setEditing(false);
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== targetTdee) await onSave(next);
  }

  // Not configured yet — a one-tap invitation, no empty scaffolding.
  if (targetTdee == null && !editing) {
    return (
      <section className="page-card health-active-target">
        <div className="health-card-eyebrow">Active target</div>
        <button type="button" className="active-target-setup" onClick={beginEdit}>
          Set a maintenance TDEE goal to see your daily active target
        </button>
      </section>
    );
  }

  // Why today's number floats: it's this week's position folded into one ask.
  // On-pace → today.target == the flat daily average exactly; behind → higher,
  // ahead → lower. A small deadband keeps it from flickering near equality.
  const dailyAvg = view?.activeTargetPerDay ?? 0;
  const diff = view ? view.today.target - dailyAvg : 0;
  const position = Math.abs(diff) <= 30 ? "on" : diff > 0 ? "behind" : "ahead";

  return (
    <section className="page-card health-active-target">
      <div className="health-active-target-head">
        <span className="health-card-eyebrow">Active target</span>
        {editing ? (
          <span className="active-target-edit">
            <input
              type="number"
              inputMode="numeric"
              className="active-target-input"
              value={draft}
              autoFocus
              placeholder="2800"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commit();
                if (e.key === "Escape") setEditing(false);
              }}
              onBlur={() => void commit()}
            />
            <span className="active-target-edit-unit">TDEE</span>
          </span>
        ) : (
          <button type="button" className="active-target-goal" onClick={beginEdit}>
            {targetTdee?.toLocaleString()} TDEE
            <PenLineGlyph />
          </button>
        )}
      </div>

      {view ? (
        <>
          <div className="active-target-ring-row">
            <ActivityRing
              pct={view.today.accrued / Math.max(1, view.today.target)}
              size={96}
              strokeWidth={9}
              color={view.today.accrued >= view.today.target ? "var(--good)" : "var(--gold)"}
              trackColor="var(--bg-soft)"
            >
              <div className="active-target-ring-center">
                <span className="active-target-ring-num">{view.today.accrued.toLocaleString()}</span>
                <span className="active-target-ring-of">of {view.today.target.toLocaleString()}</span>
              </div>
            </ActivityRing>
            <div className="active-target-ring-caption">
              <span className="active-target-ring-title">Today's target</span>
              <span className="active-target-ring-sub">
                {position === "behind"
                  ? `Behind this week — today's up from your ${dailyAvg.toLocaleString()}/day average`
                  : position === "ahead"
                    ? `Ahead this week — today eased below your ${dailyAvg.toLocaleString()}/day average`
                    : `On pace — about your ${dailyAvg.toLocaleString()}/day average`}
              </span>
              {!view.today.synced && (
                <span className="active-target-ring-stale">
                  {view.today.lastSyncDate
                    ? `Not synced today — last reading ${view.today.lastSyncDate}`
                    : "Not synced yet"}
                </span>
              )}
            </div>
          </div>

          {view.session && view.session.workoutsNeeded > 0 && (
            <div className="active-target-hint">
              <span>A typical session adds ~{view.session.boost.toLocaleString()} active</span>
              <span>
                {view.session.workoutsNeeded === 1
                  ? "One more workout this week closes the gap"
                  : `${view.session.workoutsNeeded} more workouts this week close the gap`}
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="page-note">
          No resting-energy baseline yet — the target needs a few days of Apple Health data.
        </p>
      )}
    </section>
  );
}

function PenLineGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 15l9-9 3 3-9 9H6v-3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sync freshness for the header note. With multiple sync methods now (scheduled
// runs, on-open), today shows the actual clock time of the last write so you can
// tell how fresh it is; yesterday reads plainly; two-plus days is a real staleness
// problem, so it flags bad.
function syncLabel(
  latest: { metric_date: string; updated_at: string } | null,
): { text: string; tone: "normal" | "bad" } | null {
  if (!latest) return null;
  const daysAgo = Math.round((Date.parse(localDateStr()) - Date.parse(latest.metric_date)) / 86400000);
  if (daysAgo <= 0) {
    const t = new Date(latest.updated_at);
    if (!Number.isNaN(t.getTime())) {
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return { text: `Synced ${hh}:${mm}`, tone: "normal" };
    }
    return { text: "Synced today", tone: "normal" };
  }
  if (daysAgo === 1) return { text: "Synced yesterday", tone: "normal" };
  return { text: `Synced ${daysAgo} days ago`, tone: "bad" };
}

export function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activity = useTabActivity();
  const toast = useToast();

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
  const lastSynced = useMemo(() => syncLabel(metrics.at(-1) ?? null), [metrics]);
  // Rendered beside the page title (Shell's PageTopBar). Memoised so the header
  // effect only re-fires when the label actually changes, not every render.
  const syncNote = useMemo(
    () =>
      lastSynced ? (
        <span className={`health-sync-note${lastSynced.tone === "bad" ? " is-bad" : ""}`}>
          {lastSynced.text}
        </span>
      ) : undefined,
    [lastSynced],
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

  // Active-energy sparkline — Active is the one behaviour-driven, trend-worthy
  // number in the Energy card, so it gets the same 14-day bucket / 84-day trend
  // shape as Body Fat and Lean Mass. Resting + TDEE ride along as model context.
  const energyBucketed = useMemo(() => {
    if (!data) return [];
    const s = series(metrics, "active_energy_kcal");
    return bucketSeries(s, { spanDays: ENERGY_BUCKET * SPARK_POINTS, bucketDays: ENERGY_BUCKET });
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

  const saveTarget = useCallback(
    async (next: number | null) => {
      // Optimistic: reflect immediately, then persist + refresh derived pace.
      setData((prev) => (prev ? { ...prev, targetTdee: next } : prev));
      try {
        await saveTargetTdee(next);
        await load();
      } catch (e) {
        toast(String((e as Error)?.message ?? e), "error");
        void load();
      }
    },
    [load, toast],
  );

  usePageHeader({ eyebrow: "HEALTH", title: "Trends", onCopy: copyHealthData, note: syncNote });

  if (error && !data) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="page health">
      {/* Active Target leads — it's the actionable, glanceable "what do I do
          today" number (the same ring worn on the avatar). TDEE right below
          is the metabolic model behind it, for whoever wants the why. */}
      {data && (
        <ActiveTargetCard
          view={data.activeTarget}
          targetTdee={data.targetTdee}
          onSave={saveTarget}
        />
      )}

      {/* TDEE — the metabolic model behind the Active Target above. The total
          stays uncoloured (a rising estimate isn't an "outcome"), but both
          components carry an up-good coloured delta vs the previous window
          (Active = did you move enough; Resting = higher rate is less metabolic
          adaptation). */}
      <section className={`page-card health-energy${!data ? " loading-card" : ""}`}>
        <div className="health-tdee-head">
          <span className="health-card-eyebrow">Active</span>
        </div>
        {!data ? (
          <>
            <div className="health-trend-head">
              <div className="health-trend-info">
                <div className="health-trend-stat">
                  <MetricValue size="xl" unit="kcal">000</MetricValue>
                </div>
                <span className="health-energy-window">14-day average</span>
              </div>
              <Sparkline points={[]} minSpan={ENERGY_MIN_SPAN} />
            </div>
            <div className="health-energy-model">
              <div className="health-energy-model-item">
                <span className="health-energy-metric-label">Resting</span>
                <MetricValue size="md" unit="kcal">0000</MetricValue>
                <span className="health-energy-window">30-day average</span>
              </div>
              <div className="health-energy-model-item">
                <span className="health-energy-metric-label">TDEE</span>
                <MetricValue size="md" unit="kcal">0000</MetricValue>
                <span className="health-energy-window">resting + active</span>
              </div>
            </div>
          </>
        ) : tdee?.tdee != null ? (
          <>
            {/* Active leads with the sparkline — the behaviour-driven number. */}
            <div className="health-trend-head">
              <div className="health-trend-info">
                <div className="health-trend-stat">
                  <MetricValue size="xl" unit="kcal">{tdee.avgActive?.toLocaleString()}</MetricValue>
                  {activeChange != null && (
                    <MetricDelta value={activeChange} direction="up-good" decimals={0} />
                  )}
                </div>
                <span className="health-energy-window">
                  {tdee.activeDays < 14 ? `${tdee.activeDays}-day average` : "14-day average"} · {ENERGY_BUCKET * SPARK_POINTS}-day trend
                </span>
              </div>
              <Sparkline points={energyBucketed} minSpan={ENERGY_MIN_SPAN} />
            </div>
            {/* Resting + TDEE — the model behind the ring, so Resting+Active=TDEE
                still visibly adds up. */}
            <div className="health-energy-model">
              <div className="health-energy-model-item">
                <span className="health-energy-metric-label">Resting</span>
                <div className="health-trend-stat">
                  <MetricValue size="md" unit="kcal">{tdee.avgResting?.toLocaleString()}</MetricValue>
                  {restingChange != null && (
                    <MetricDelta value={restingChange} direction="up-good" decimals={0} />
                  )}
                </div>
                <span className="health-energy-window">
                  {tdee.restingDays < 30 ? `${tdee.restingDays}-day average` : "30-day average"}
                </span>
              </div>
              <div className="health-energy-model-item">
                <span className="health-energy-metric-label">TDEE</span>
                <MetricValue size="md" unit="kcal">{tdee.tdee.toLocaleString()}</MetricValue>
                <span className="health-energy-window">resting + active</span>
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
          avgLabel="14-day average"
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
          avgLabel="14-day average"
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
