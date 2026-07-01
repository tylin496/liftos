import { useEffect, useRef, useState } from "react";
import { fetchOverview, type OverviewData } from "./api";
import { RECOVERY_STATUS_COLOR, type RecoverySnapshot } from "@features/health/math";
import { useCountUp } from "@shared/hooks/useCountUp";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { MacroEditFields, type MacroField } from "@shared/components/MacroEditFields";
import "@shared/components/nutriGrid.css";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { useSessionUser } from "@app/layout/SessionContext";
import { useToast } from "@shared/components/Toast";
import { saveEntry, deleteEntry, getConfig, type NutritionConfig } from "@features/nutrition/api";
import { recomputeAndPersist, type NutritionStateFull } from "@features/nutrition/evaluationApi";
import type { Recommendation } from "@features/overview/recommendations";
import {
  defaultLogDate,
  getCalorieResult,
  getProteinResult,
  calorieTone,
  calorieNote,
  proteinNote,
} from "@features/nutrition/logic";
import type { TabId } from "@app/layout/TabBar";
import "./overview.css";

const copyAllData = () => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS);

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

  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;
  const calorieTarget = nutritionTargets?.calorieTarget ?? 0;
  const deficitTarget = nutritionTargets?.deficitTarget ?? 0;
  const tdeeTarget = nutritionTargets?.tdeeTarget ?? 0;

  const calN = Number(calories) || 0;
  const protN = Number(protein) || 0;

  const kcalCount = useCountUp(calN, 400);
  const proteinCount = useCountUp(protN, 400);

  // Same on-plan/over/surplus feedback as Nutrition's Today card — same
  // underlying daily entry, so the same language.
  const calResult = getCalorieResult(calN, tdeeTarget, deficitTarget);
  const protResult = getProteinResult(protN, proteinTarget);
  const calTone = calorieTone(hasEntry, calResult);
  const calNote = calorieNote(hasEntry, calResult, deficitTarget);
  const protNote = proteinNote(hasEntry, protN, proteinTarget);

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
          <button type="button" className="nutri-col" aria-label="Edit calories" onClick={() => openEdit("calories")}>
            <span className="nutri-label">Calories</span>
            {hasEntry ? (
              <MetricValue size="lg" className="nutri-val--green">{kcalCount.toLocaleString()}</MetricValue>
            ) : (
              <MetricValue size="lg" className="stat-number--empty">—</MetricValue>
            )}
            {tdeeTarget > 0 && <MetricCaption>of {calorieTarget.toLocaleString()} kcal</MetricCaption>}
            {calNote && (
              <span className={`nutri-delta ${calTone ?? "neutral"}`}>{calNote}</span>
            )}
          </button>
          <button type="button" className="nutri-col" aria-label="Edit protein" onClick={() => openEdit("protein")}>
            <span className="nutri-label">Protein</span>
            {hasEntry ? (
              <MetricValue size="lg" className="nutri-val--blue">{proteinCount}</MetricValue>
            ) : (
              <MetricValue size="lg" className="stat-number--empty">—</MetricValue>
            )}
            {proteinTarget > 0 && <MetricCaption>of {proteinTarget} g</MetricCaption>}
            {protNote && (
              <span className={`nutri-delta ${protResult.celebrated ? "good" : "neutral"}`}>{protNote}</span>
            )}
          </button>
        </div>
      )}
    </section>
  );
}

/* ── Training Health Card ──────────────────────────────────────────────── */

// On-track rows show "% of all-time PR" (how close to your best). Flagged
// (watch) rows instead carry a STALLED badge counting whole weeks since the
// last new best — that's what actually earned the flag, and it reads clearer
// than a % that could look like a contradiction (e.g. "97% · Review").
function exerciseRetention(ex: import("./api").StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

function fmtStalled(weeks: number): string {
  if (weeks < 1) return "STALLED";
  return `STALLED ${weeks} ${weeks === 1 ? "WK" : "WKS"}`;
}

function fmtSignedDelta(value: number, decimals: number, unit?: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const abs = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${sign}${abs} ${unit}` : `${sign}${abs}`;
}

function ExerciseRow({ exercise }: { exercise: import("./api").StrengthExercise }) {
  const isWatch = exercise.status === "watch";
  if (isWatch) {
    return (
      <div className="ov-th-ex-row watch">
        <span className="ov-th-ex-name">{exercise.name}</span>
        <span className="ov-th-stalled">{fmtStalled(exercise.stalledWeeks)}</span>
      </div>
    );
  }
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  return (
    <div className="ov-th-ex-row">
      <span className="ov-th-ex-name">{exercise.name}</span>
      <span className="ov-th-ex-pct">{retPct}%</span>
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
        <span className="ov-th-label">Training Health</span>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          Log at least 4 sessions per exercise to see training health.
        </p>
      </button>
    );
  }

  return (
    <div className={`page-card ov-training-health${expanded ? " is-expanded" : ""}`}>
      {/* Tapping the header navigates to Training (matches Weight·TDEE's
          whole-card-navigates pattern) — expand/collapse is the dedicated
          "{N} more on track" toggle below, not this header. */}
      <button type="button" className="ov-th-summary" onClick={onNav}>
        <div className="ov-th-top">
          <span className="ov-th-label">Training Health</span>
          <span className="ov-th-chevron" aria-hidden>›</span>
        </div>

        {retentionPct !== null && (
          <div className="ov-th-ret-hero">
            <MetricValue size="md">{retCount}%</MetricValue>
            <MetricCaption>of tracked lifts on track</MetricCaption>
          </div>
        )}

      </button>

      {/* Attention is always visible (not gated behind expand) — it's the
          urgent signal; On Track is the reassurance detail, kept collapsed. */}
      {watchExercises.length > 0 && (
        <div className="ov-th-section">
          <div className="ov-th-sect-head">Attention · {watchExercises.length}</div>
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
        <svg
          className={`ov-th-toggle-chevron${expanded ? " is-open" : ""}`}
          width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
        <MetricDelta value={delta} higherBetter={higherBetter} decimals={decimals} unit="vs 30d" />
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

/* ── System Card ───────────────────────────────────────────────────────── */

// The single highest-priority recommendation across every provider. Overview
// performs no analysis here — it just displays what the registry decided and
// links to the owning feature. Nutrition is the only provider today; adding
// more never touches this card.
const REC_TAB: Record<Recommendation["source"], TabId> = {
  nutrition: "nutrition",
  training: "training",
  weight: "health",
  recovery: "health",
};

function SystemCard({ rec, onNav }: { rec: Recommendation; onNav: (tab: TabId) => void }) {
  return (
    <button type="button" className="page-card ov-system" onClick={() => onNav(REC_TAB[rec.source])}>
      <div className="ov-system-head">
        <span className="ov-system-label">System</span>
        <span className="ov-system-chevron" aria-hidden>›</span>
      </div>
      <p className="ov-system-title">{rec.title}</p>
      <p className="ov-system-sub">{rec.subtitle}</p>
    </button>
  );
}

/* ── Nutrition Summary ─────────────────────────────────────────────────── */

// Brief nutrition snapshot: the current goal + a one-word status. This is the
// *state* (not the action — the System card carries the action), so the two
// never read as duplicates even while Nutrition is the only recommender.
function nutritionStatusLabel(state: NutritionStateFull): string {
  const { evaluation } = state;
  if (evaluation.confidence === "low") return "Calibrating";
  if (evaluation.status === "on_target") return "On track";
  return evaluation.status === "below_target" ? "Below pace" : "Above pace";
}

function NutritionSummary({ state, onNav }: { state: NutritionStateFull; onNav: () => void }) {
  const goal = state.diagnostics.calorieTarget;
  return (
    <button type="button" className="page-card ov-nutri-summary" onClick={onNav}>
      <div className="ov-ns-head">
        <span className="ov-ns-label">Nutrition</span>
        <span className="ov-ns-chevron" aria-hidden>›</span>
      </div>
      <div className="ov-ns-cols">
        <div className="ov-ns-col">
          <span className="ov-ns-key">Current Goal</span>
          <MetricValue size="md" unit="kcal">{goal.toLocaleString()}</MetricValue>
        </div>
        <div className="ov-ns-divider" />
        <div className="ov-ns-col">
          <span className="ov-ns-key">Status</span>
          <span className="ov-ns-status">{nutritionStatusLabel(state)}</span>
        </div>
      </div>
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

  usePageHeader({ eyebrow: fmtTopbarDate(), title: greeting(user), onCopy: copyAllData });

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} />
      </div>
    );
  }

  // Refresh Overview immediately after a save, then recompute the shared
  // evaluation and refresh again so the System card / Nutrition Summary pick up
  // the fresh state. Fire-and-forget — never blocks the save.
  function handleSaved() {
    setRefreshKey((k) => k + 1);
    void recomputeAndPersist()
      .then(() => setRefreshKey((k) => k + 1))
      .catch(() => {});
  }

  return (
    <div className="page">
      {data?.nutritionState?.recommendation && (
        <SystemCard rec={data.nutritionState.recommendation} onNav={(tab) => nav(tab)} />
      )}

      <HeroCard data={data} onSaved={handleSaved} />

      {data?.nutritionState && (
        <NutritionSummary state={data.nutritionState} onNav={() => nav("nutrition")} />
      )}

      {data && <RecoveryCard snap={data.recovery} onNav={() => nav("health")} />}

      <button type="button" className="page-card ov-dual" onClick={() => nav("health")}>
        <div className="ov-dual-col">
          <span className="ov-stat-label">Weight · 7D</span>
          {data?.weightLatest != null ? (
            <>
              <div className="ov-dual-val-row">
                <MetricValue size="sm" unit="kg">{data.weightLatest}</MetricValue>
                {data.weightWeekAgo != null && (
                  <span className="nutri-delta neutral">
                    {fmtSignedDelta(parseFloat((data.weightLatest - data.weightWeekAgo).toFixed(1)), 1, "kg")}
                  </span>
                )}
              </div>
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
              <div className="ov-dual-val-row">
                <MetricValue size="sm" unit="kcal">{tdeeCount.toLocaleString()}</MetricValue>
                {data.tdeePrev != null && (
                  <MetricDelta value={data.tdee - data.tdeePrev} higherBetter threshold={40} />
                )}
              </div>
            </>
          ) : (
            <span className="ov-stat-val empty">{data ? "—" : "0"}</span>
          )}
        </div>
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
