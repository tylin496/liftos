import { useEffect, useRef, useState } from "react";
import { fetchOverview, type OverviewData } from "./api";
import { RECOVERY_STATUS_COLOR, type RecoverySnapshot } from "@features/health/math";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { useCountUp } from "@shared/hooks/useCountUp";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { PageTopBar } from "@shared/components/PageTopBar";
import { MacroEditFields, type MacroField } from "@shared/components/MacroEditFields";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import "@shared/components/nutriGrid.css";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { useSessionUser } from "@app/layout/SessionContext";
import { useToast } from "@shared/components/Toast";
import { saveEntry, deleteEntry, getConfig, type NutritionConfig } from "@features/nutrition/api";
import { defaultLogDate } from "@features/nutrition/logic";
import "./overview.css";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtTopbarDate(): string {
  const d = new Date();
  return `${WEEKDAY_ABBR[d.getDay()]}, ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`.toUpperCase();
}

function greeting(user: ReturnType<typeof useSessionUser>): string {
  const hour = new Date().getHours();
  const time = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "there";
  return `Good ${time}, ${name}`;
}

/* ── Hero Card ─────────────────────────────────────────────────────────── */

function HeroCard({ data, onSaved }: { data: OverviewData | null; onSaved: () => void }) {
  const toast = useToast();
  const nutritionTargets = data?.nutritionTargets;

  const savedKcal = data?.today?.calories ?? null;
  const savedProtein = data?.today?.protein ?? null;
  const hasEntry = savedKcal != null || savedProtein != null;

  const [editing, setEditing] = useState(false);
  const [field, setField] = useState<MacroField>("calories");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [saving, setSaving] = useState(false);
  const configRef = useRef<NutritionConfig | null>(null);

  // Sync local fields from the saved entry — but never clobber an in-progress
  // edit. After a save, the refetch flows back here and resets the baseline.
  useEffect(() => {
    if (editing) return;
    setCalories(savedKcal != null ? String(savedKcal) : "");
    setProtein(savedProtein != null ? String(savedProtein) : "");
  }, [savedKcal, savedProtein, editing]);

  const kcalTarget = nutritionTargets?.calorieTarget ?? 0;
  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;

  const calN = Number(calories) || 0;
  const protN = Number(protein) || 0;

  const kcalCount = useCountUp(calN, 400);
  const proteinCount = useCountUp(protN, 400);

  const kcalRemaining = kcalTarget > 0 ? kcalTarget - calN : null;
  const proteinGap = proteinTarget > 0 ? proteinTarget - protN : null;

  function openEdit(f: MacroField) {
    setField(f);
    setEditing(true);
  }

  async function doSave(calVal: number, protVal: number) {
    if (saving) return;
    setSaving(true);
    try {
      if (!configRef.current) configRef.current = await getConfig();
      await saveEntry(defaultLogDate(), { calories: calVal, protein: protVal }, configRef.current);
      setEditing(false);
      if (navigator.vibrate) navigator.vibrate([18, 30, 18]);
      onSaved();
      toast("Logged", "success");
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteEntry(defaultLogDate());
      setEditing(false);
      onSaved();
      toast("Entry deleted", "info");
    } catch (e) {
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-card ov-hero">
      <p className="page-eyebrow">TODAY · NUTRITION</p>

      {editing ? (
        <MacroEditFields
          calories={calories}
          protein={protein}
          onCaloriesChange={setCalories}
          onProteinChange={setProtein}
          activeField={field}
          onActiveFieldChange={setField}
          onSave={doSave}
          onCancel={() => setEditing(false)}
          onDelete={hasEntry ? handleDelete : undefined}
          saving={saving}
          hasEntry={hasEntry}
        />
      ) : (
        <div className="nutri-grid">
          <button type="button" className="nutri-col" onClick={() => openEdit("calories")}>
            <span className="nutri-label">Calories</span>
            <MetricValue size="lg" tone="good">{kcalCount.toLocaleString()}</MetricValue>
            {kcalTarget > 0 && <MetricCaption>of {kcalTarget.toLocaleString()} kcal</MetricCaption>}
            {kcalRemaining != null && (
              <span className={`nutri-delta ${kcalRemaining >= 0 ? "good" : "bad"}`}>
                {kcalRemaining >= 0 ? "−" : "+"}{Math.abs(kcalRemaining).toLocaleString()}{" "}
                {kcalRemaining >= 0 ? "remaining" : "over"}
              </span>
            )}
          </button>
          <button type="button" className="nutri-col" onClick={() => openEdit("protein")}>
            <span className="nutri-label">Protein</span>
            <MetricValue size="lg" className="nutri-val--blue">{proteinCount}</MetricValue>
            {proteinTarget > 0 && <MetricCaption>of {proteinTarget} g</MetricCaption>}
            {proteinGap != null && (
              <span className="nutri-delta neutral">
                {proteinGap > 0 ? `${proteinGap}g to floor` : "✓ Target met"}
              </span>
            )}
          </button>
        </div>
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

      </button>

      {/* Attention is always visible (not gated behind expand) — it's the
          urgent signal; On Track is the reassurance detail, kept collapsed. */}
      {watchExercises.length > 0 && (
        <div className="ov-th-section">
          <div className="ov-th-sect-head attention">Attention · {watchExercises.length}</div>
          {watchExercises.map((ex) => (
            <ExerciseRow key={ex.slug} exercise={ex} />
          ))}
        </div>
      )}
      {attention === 0 && (
        <div className="ov-th-status">
          <span className="ov-th-all-good">All exercises on track</span>
        </div>
      )}

      <button
        type="button"
        className="ov-th-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less" : `${onTrackExercises.length} more on track`}
        <span className={`ov-th-toggle-chevron${expanded ? " is-open" : ""}`} aria-hidden>▾</span>
      </button>

      {expanded && (
        <div className="ov-th-expanded">
          {onTrackExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head">On track · {onTrackExercises.length}</div>
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

          <button type="button" className="ov-th-nav-btn" onClick={onNav}>
            Open Training →
          </button>
        </div>
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
        <span className="ov-rec-status" style={{ color }}>
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
  const user = useSessionUser();
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
      <PageTopBar eyebrow={fmtTopbarDate()} title={greeting(user)} />

      <HeroCard data={data} onSaved={() => setRefreshKey((k) => k + 1)} />

      {data && <RecoveryCard snap={data.recovery} onNav={() => nav("health")} />}

      <button type="button" className="page-card ov-dual" onClick={() => nav("health")}>
        <div className="ov-dual-col">
          <span className="ov-stat-label">Weight · 7D</span>
          {data?.weightLatest != null ? (
            <>
              <MetricValue size="sm" unit="kg">{data.weightLatest}</MetricValue>
              {data.weightWeekAgo != null && (
                <MetricDelta
                  value={parseFloat((data.weightLatest - data.weightWeekAgo).toFixed(1))}
                  higherBetter={false}
                  decimals={1}
                  unit="kg"
                />
              )}
            </>
          ) : (
            <span className="ov-stat-val empty">{data ? "—" : "–"}</span>
          )}
        </div>

        <div className="ov-dual-divider" />

        <div className="ov-dual-col">
          <span className="ov-stat-label">TDEE · 14D</span>
          {data?.tdee != null ? (
            <>
              <MetricValue size="sm" unit="kcal">{tdeeCount.toLocaleString()}</MetricValue>
              {data.tdeePrev != null && (
                // higherBetter — per design call, a rising TDEE reads green here;
                // it's a deliberate UX choice, not an objective "good".
                <MetricDelta value={data.tdee - data.tdeePrev} higherBetter threshold={40} />
              )}
            </>
          ) : (
            <span className="ov-stat-val empty">{data ? "—" : "0"}</span>
          )}
        </div>

        <span className="ov-dual-chevron" aria-hidden>›</span>
      </button>

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
