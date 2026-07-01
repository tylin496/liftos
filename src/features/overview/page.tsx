import { useEffect, useRef, useState } from "react";
import { fetchOverview, type OverviewData } from "./api";
import { RECOVERY_STATUS_COLOR, type RecoverySnapshot } from "@features/health/math";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { useCountUp } from "@shared/hooks/useCountUp";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { useToast } from "@shared/components/Toast";
import { saveEntry, getConfig, type NutritionConfig } from "@features/nutrition/api";
import { defaultLogDate } from "@features/nutrition/logic";
import "./overview.css";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(): string {
  const d = new Date();
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function pct(val: number, target: number): number {
  if (!target) return 0;
  return Math.min(100, Math.round((val / target) * 100));
}

/* ── Hero Card ─────────────────────────────────────────────────────────── */

function HeroRow({
  label,
  unit,
  editing,
  value,
  displayCount,
  target,
  pctVal,
  barsReady,
  barClass,
  inputRef,
  onOpen,
  onChange,
  onCommit,
}: {
  label: string;
  unit: string;
  editing: boolean;
  value: string;
  displayCount: number;
  target: number;
  pctVal: number;
  barsReady: boolean;
  barClass: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onOpen: () => void;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="ov-hero-row">
      <span className="ov-hero-label">{label}</span>
      <div className="ov-hero-values">
        {editing ? (
          <input
            ref={inputRef}
            className="ov-hero-input"
            type="number"
            inputMode="numeric"
            value={value}
            placeholder="0"
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommit(); }
            }}
          />
        ) : (
          <button type="button" className="ov-hero-num ov-hero-num--edit" onClick={onOpen}>
            {displayCount.toLocaleString()}
          </button>
        )}
        {target > 0 && (
          <span className="ov-hero-denom">/ {target.toLocaleString()} {unit}</span>
        )}
      </div>
      {target > 0 && (
        <div className="ov-bar-track">
          <div
            className={`ov-bar-fill ${barClass}${barsReady ? " anim" : ""}${pctVal >= 100 ? " complete" : ""}`}
            style={{ width: barsReady ? `${pctVal}%` : "0%" }}
          />
        </div>
      )}
    </div>
  );
}

function HeroCard({ data, onSaved }: { data: OverviewData | null; onSaved: () => void }) {
  const toast = useToast();
  const nutritionTargets = data?.nutritionTargets;
  const tdee = data?.tdee;

  const savedKcal = data?.today?.calories ?? null;
  const savedProtein = data?.today?.protein ?? null;

  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [editField, setEditField] = useState<"calories" | "protein" | null>(null);
  const [saving, setSaving] = useState(false);
  const configRef = useRef<NutritionConfig | null>(null);
  const calInputRef = useRef<HTMLInputElement>(null);
  const protInputRef = useRef<HTMLInputElement>(null);

  // Sync local fields from the saved entry — but never clobber an in-progress
  // edit. After a save, the refetch flows back here and resets the baseline.
  useEffect(() => {
    if (editField !== null) return;
    setCalories(savedKcal != null ? String(savedKcal) : "");
    setProtein(savedProtein != null ? String(savedProtein) : "");
  }, [savedKcal, savedProtein, editField]);

  useEffect(() => {
    if (editField === "calories") setTimeout(() => calInputRef.current?.select(), 30);
    else if (editField === "protein") setTimeout(() => protInputRef.current?.select(), 30);
  }, [editField]);

  const kcalTarget = nutritionTargets?.calorieTarget ?? 0;
  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;

  const calN = Number(calories) || 0;
  const protN = Number(protein) || 0;

  const kcalCount = useCountUp(calN, 400);
  const proteinCount = useCountUp(protN, 400);

  const [barsReady, setBarsReady] = useState(false);
  const barRafRef = useRef(0);
  useEffect(() => {
    barRafRef.current = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(barRafRef.current);
  }, []);

  const hasInput = calories !== "" || protein !== "";
  const dirty = calN !== (savedKcal ?? 0) || protN !== (savedProtein ?? 0);
  const showBalance = tdee != null && hasInput;
  const balance = showBalance ? calN - (tdee as number) : 0;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      if (!configRef.current) configRef.current = await getConfig();
      await saveEntry(defaultLogDate(), { calories: calN, protein: protN }, configRef.current);
      setEditField(null);
      if (navigator.vibrate) navigator.vibrate([18, 30, 18]);
      onSaved();
      toast("Logged", "success");
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-card ov-hero">
      <p className="ov-hero-eyebrow">Today · {fmtDate()}</p>

      <HeroRow
        label="Calories" unit="kcal"
        editing={editField === "calories"}
        value={calories} displayCount={kcalCount}
        target={kcalTarget} pctVal={pct(calN, kcalTarget)}
        barsReady={barsReady} barClass="calorie"
        inputRef={calInputRef}
        onOpen={() => setEditField("calories")}
        onChange={setCalories}
        onCommit={() => setEditField(null)}
      />

      <HeroRow
        label="Protein" unit="g"
        editing={editField === "protein"}
        value={protein} displayCount={proteinCount}
        target={proteinTarget} pctVal={pct(protN, proteinTarget)}
        barsReady={barsReady} barClass="protein"
        inputRef={protInputRef}
        onOpen={() => setEditField("protein")}
        onChange={setProtein}
        onCommit={() => setEditField(null)}
      />

      {showBalance && (
        <div className="ov-hero-balance">
          <span className="ov-hero-label">{balance <= 0 ? "Deficit" : "Surplus"}</span>
          <span className={`ov-hero-balance-num ${balance <= 0 ? "good" : "bad"}`}>
            {balance > 0 ? "+" : balance < 0 ? "−" : ""}
            {Math.abs(balance).toLocaleString()} kcal
          </span>
        </div>
      )}

      {dirty && (
        <button type="button" className="ov-hero-save" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : savedKcal == null && savedProtein == null ? "Log today" : "Update"}
        </button>
      )}
    </section>
  );
}

/* ── Training Health Card ──────────────────────────────────────────────── */

// The row's % is "% of all-time PR" (how close to your best). The watch flag,
// however, comes from the recent-vs-prior trend (api `status`/`trend`) — a
// different metric. So for flagged rows we surface that trend delta, which is
// what actually earned the flag, instead of a label derived from the % (which
// could read as a contradiction, e.g. "97% · Review").
function exerciseRetention(ex: import("./api").StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

function fmtTrend(trend: number): string {
  const pct = Math.round((trend - 1) * 100);
  if (pct === 0) return "±0%";
  return pct > 0 ? `↑${pct}%` : `↓${Math.abs(pct)}%`;
}

function ExerciseRow({ exercise }: { exercise: import("./api").StrengthExercise }) {
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  const isWatch = exercise.status === "watch";
  return (
    <div className={`ov-th-ex-row${isWatch ? " watch" : ""}`}>
      <span className="ov-th-ex-name">
        {isWatch && <span className="ov-th-ex-icon" aria-hidden>⚠</span>}
        {exercise.name}
      </span>
      <span className={`ov-th-ex-pct${isWatch ? " bad" : ""}`}>{retPct}%</span>
      {isWatch && <span className="ov-th-ex-trend">{fmtTrend(exercise.trend)}</span>}
    </div>
  );
}

const ON_TRACK_PREVIEW = 5;

function TrainingHealthCard({
  strength,
  compoundProgress,
  onNav,
}: {
  strength: import("./api").StrengthSummary;
  compoundProgress: import("./api").CompoundProgress | null;
  onNav: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllOnTrack, setShowAllOnTrack] = useState(false);
  const hasData = strength.total > 0;
  const retentionPct = compoundProgress ? Math.round(compoundProgress.overall * 100) : null;
  const retCount = useCountUp(retentionPct ?? 0, 600);
  const attention = strength.watch;

  // Attention always sits above On Track and is ordered worst-first (steepest
  // recent decline, i.e. lowest trend), so the most urgent exercise reads first.
  const watchExercises = strength.exercises
    .filter((e) => e.status === "watch")
    .sort((a, b) => a.trend - b.trend);
  const onTrackExercises = strength.exercises.filter((e) => e.status !== "watch");
  const onTrackVisible = showAllOnTrack
    ? onTrackExercises
    : onTrackExercises.slice(0, ON_TRACK_PREVIEW);
  const onTrackHidden = onTrackExercises.length - onTrackVisible.length;

  if (!hasData) {
    return (
      <button type="button" className="page-card ov-training-health ov-training-health--nav" onClick={onNav}>
        <span className="ov-th-label">Training</span>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          Log at least 4 sessions per exercise to see training health.
        </p>
      </button>
    );
  }

  return (
    <div className={`page-card ov-training-health${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="ov-th-summary"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="ov-th-top">
          <span className="ov-th-label">Training</span>
          <span className="ov-th-chevron" aria-hidden>▾</span>
        </div>

        {retentionPct !== null && (
          <div className="ov-th-ret-hero">
            <MetricValue
              size="xl"
              tone={retentionPct >= 95 ? "good" : retentionPct >= 85 ? undefined : "bad"}
            >
              {retCount}%
            </MetricValue>
            <span className="ov-th-ret-sub">Retention</span>
          </div>
        )}

        <div className="ov-th-status">
          {attention > 0 ? (
            <span className="ov-th-attention">{attention} Attention</span>
          ) : (
            <span className="ov-th-all-good">All exercises on track</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="ov-th-expanded">
          {watchExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head attention">
                Attention ({watchExercises.length})
              </div>
              {watchExercises.map((ex) => (
                <ExerciseRow key={ex.slug} exercise={ex} />
              ))}
            </div>
          )}

          {onTrackExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head">
                On Track ({onTrackExercises.length})
              </div>
              {onTrackVisible.map((ex) => (
                <ExerciseRow key={ex.slug} exercise={ex} />
              ))}
              {(onTrackHidden > 0 || showAllOnTrack) && (
                <button
                  type="button"
                  className="ov-th-show-more"
                  onClick={() => setShowAllOnTrack((v) => !v)}
                >
                  {showAllOnTrack ? "Show less" : `Show ${onTrackHidden} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <button type="button" className="ov-th-nav-btn" onClick={onNav}>
          Open Training →
        </button>
      )}
    </div>
  );
}

/* ── Recovery Card ─────────────────────────────────────────────────────── */

// Compact mirror of the Health tab's Recovery card: status word + the three
// signals against their 30-day baseline + the shared one-line insight. No
// chart, gauge, or score — Overview answers "how am I today?" at a glance;
// trends live in the Health tab.
function RecoveryMetric({
  label,
  value,
  unit,
  decimals,
  delta,
  higherBetter,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals: number;
  delta: number | null;
  higherBetter: boolean;
}) {
  const fmt = (v: number) =>
    v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return (
    <div className="ov-rec-metric">
      <span className="ov-rec-metric-label">{label}</span>
      <MetricValue size="md" unit={value != null ? unit : undefined}>
        {value != null ? fmt(value) : "—"}
      </MetricValue>
      <span className="ov-rec-metric-delta-slot">
        <MetricDelta value={delta} higherBetter={higherBetter} decimals={decimals} />
      </span>
    </div>
  );
}

function RecoveryCard({ snap, onNav }: { snap: RecoverySnapshot | null; onNav: () => void }) {
  if (!snap || !snap.status) {
    return (
      <button type="button" className="page-card ov-recovery ov-recovery--empty" onClick={onNav}>
        <div className="ov-rec-head">
          <span className="ov-rec-title">Recovery</span>
        </div>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          No recovery data yet — sync sleep, HRV & resting HR from Apple Health.
        </p>
      </button>
    );
  }

  const sleepDelta = snap.sleepHours != null && snap.sleepBaseline != null
    ? snap.sleepHours - snap.sleepBaseline : null;
  const hrvDelta = snap.hrv != null && snap.hrvBaseline != null
    ? snap.hrv - snap.hrvBaseline : null;
  const rhrDelta = snap.rhr != null && snap.rhrBaseline != null
    ? snap.rhr - snap.rhrBaseline : null;
  const color = RECOVERY_STATUS_COLOR[snap.status];

  return (
    <button type="button" className="page-card ov-recovery" onClick={onNav}>
      <div className="ov-rec-head">
        <span className="ov-rec-title">Recovery</span>
        <span
          className="ov-rec-status"
          style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          {snap.status}
        </span>
      </div>
      <div className="ov-rec-metrics">
        <RecoveryMetric label="Sleep" value={snap.sleepHours} unit="h"   decimals={1} delta={sleepDelta} higherBetter />
        <RecoveryMetric label="HRV"   value={snap.hrv}        unit="ms"  decimals={0} delta={hrvDelta}   higherBetter />
        <RecoveryMetric label="RHR"   value={snap.rhr}        unit="bpm" decimals={0} delta={rhrDelta}   higherBetter={false} />
      </div>
      {snap.insight && <p className="ov-rec-insight">{snap.insight}</p>}
    </button>
  );
}

/* ── Overview Page ─────────────────────────────────────────────────────── */

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activity = useTabActivity();
  const nav = useNav();
  const [refreshKey, setRefreshKey] = useState(0);
  const tdeeCount = useCountUp(data?.tdee ?? 0, 500);

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [activity, refreshKey]);

  useCopyButton(() => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS));

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="page">
      <HeroCard data={data} onSaved={() => setRefreshKey((k) => k + 1)} />

      <div className="ov-grid-2">
        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">Weight</span>
          {data?.weightLatest != null ? (
            <>
              <MetricValue size="sm" unit="kg">{data.weightLatest}</MetricValue>
              <span className="ov-stat-sub-row">
                {data.weightWeekAgo != null ? (
                  <MetricDelta
                    value={parseFloat((data.weightLatest - data.weightWeekAgo).toFixed(1))}
                    higherBetter={false}
                    decimals={1}
                    unit="kg"
                  />
                ) : null}
                <MetricCaption>/ 7 days</MetricCaption>
              </span>
            </>
          ) : (
            <>
              <span className="ov-stat-val empty">{data ? "—" : "–"}</span>
              <span className="ov-stat-sub">{data ? "no data" : "kg"}</span>
            </>
          )}
        </button>

        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">TDEE</span>
          {data?.tdee != null ? (
            <>
              <MetricValue size="sm" unit="kcal/day">{tdeeCount.toLocaleString()}</MetricValue>
              <span className="ov-stat-sub-row">
                {data.tdeePrev != null ? (
                  // higherBetter — per design call, a rising TDEE reads green here;
                  // it's a deliberate UX choice, not an objective "good".
                  <MetricDelta
                    value={data.tdee - data.tdeePrev}
                    higherBetter
                    threshold={40}
                  />
                ) : null}
                <MetricCaption>vs 14 days</MetricCaption>
              </span>
            </>
          ) : (
            <>
              <span className="ov-stat-val empty">{data ? "—" : "0"}</span>
              <span className="ov-stat-sub">{data ? "no Health data" : "kcal/day"}</span>
            </>
          )}
        </button>
      </div>

      {data && <RecoveryCard snap={data.recovery} onNav={() => nav("health")} />}

      {data && (
        <TrainingHealthCard
          strength={data.strength}
          compoundProgress={data.compoundProgress}
          onNav={() => nav("training")}
        />
      )}
    </div>
  );
}
