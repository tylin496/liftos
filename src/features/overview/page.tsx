import { useEffect, useState } from "react";
import { fetchOverview, saveCutBaseline, type OverviewData } from "./api";
import { cutBaselineAt } from "./goal";
import type { BodyMetric } from "@features/health/api";
import { RECOVERY_STATUS_COLOR, series, rollingAvg, type RecoverySnapshot } from "@features/health/math";
import { useCountUp } from "@shared/hooks/useCountUp";
import { useInView } from "@shared/hooks/useInView";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { useSessionUser } from "@app/layout/SessionContext";
import type { NutritionStateFull } from "@features/nutrition/evaluationApi";
import { MIN_TREND_POINTS } from "@features/nutrition/evaluation";
import { paceLabel, paceTone } from "@features/nutrition/recommendation";
import type { Recommendation } from "@features/overview/recommendations";
import type { Goal } from "./goal";
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
  const time =
    hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const name =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "there";
  return time === "night" ? `Still up, ${name}` : `Good ${time}, ${name}`;
}

/** Signed weekly weight change, kg/week (e.g. "−0.46 kg/week"). */
function fmtTrend(kgPerWeek: number): string {
  const sign = kgPerWeek < 0 ? "−" : kgPerWeek > 0 ? "+" : "±";
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)} kg/week`;
}

/** Days since the current cut began, as "(141 d)" — appended after the pace
 *  status word so Weight can answer "how long have I been at this rate?"
 *  without a separate row. Mirrors Cut Progress's baseline. */
function fmtDaysSince(isoDate: string): string {
  const start = new Date(isoDate + "T12:00:00");
  const days = Math.round((Date.now() - start.getTime()) / 86400000);
  return `(${days} d)`;
}

/* ── System Card ───────────────────────────────────────────────────────── */

// The single highest-priority recommendation across every provider. Overview
// performs no analysis here — it just displays what the registry decided and
// links to the owning feature. This is a command center: it answers "do I need
// to do something?", not "is my strategy working?". Line 1 is the *decision*
// ("No action needed" / "Review calorie target"); line 2 is the *reason*, and
// deliberately carries no number — the calorie target lives on the Nutrition
// card, never duplicated here. Nutrition is the only provider today; adding
// more never touches this card.
const REC_TAB: Record<Recommendation["source"], TabId> = {
  nutrition: "nutrition",
  training: "training",
  weight: "health",
  recovery: "health",
};

function SystemCard({ rec, onNav }: { rec: Recommendation; onNav: (tab: TabId) => void }) {
  const { ref, inView } = useInView<HTMLButtonElement>();
  // Command center: only surface the card when there's something to act on.
  // "No action needed" means nothing to do, so the whole banner (and its
  // divider) disappears rather than sitting there confirming nothing's wrong.
  if (rec.title === "No action needed") return null;
  return (
    <button type="button" ref={ref} data-inview={inView} className="ov-system-banner" onClick={() => onNav(REC_TAB[rec.source])}>
      <span className="ov-system-dot" />
      <span className="ov-system-body">
        <span className="ov-system-label">System</span>
        <span className="ov-system-title">{rec.title}</span>
        <span className="ov-system-sub">{rec.subtitle}</span>
      </span>
      <span className="ov-system-chevron" aria-hidden>›</span>
    </button>
  );
}

/* ── Cut Progress Card ─────────────────────────────────────────────────── */

// Answers one question only: "how far am I from my destination?" A single
// merged Goal line (goal weight · target body fat) plus what's left to lose.
// Pure render — every number is finished upstream in computeGoal (the Goal
// provider); the card holds no business logic. Deliberately does NOT show
// current weight or trend: that's the Weight card's job ("where am I today,
// and am I progressing at the planned rate?"). Responsibilities stay distinct.
function CutProgressCard({ goal, onNav }: { goal: Goal; onNav: () => void }) {
  const e = goal.evaluation;
  const pct = Math.round(e.progressPct);
  const isComplete = pct >= 100;
  // Fill the % and the bar from 0 once the card scrolls into view (before that,
  // hold both at 0 so the reveal is visible when reached). useCountUp and the
  // bar's width transition both honor prefers-reduced-motion → snap to final.
  const { ref, inView } = useInView<HTMLButtonElement>();
  const pctCount = useCountUp(inView ? pct : 0, 700);
  const barPct = inView ? pct : 0;

  // Celebrate reaching 100% exactly once per cut (identified by its goal
  // weight — a new baseline produces a new goal weight, so a fresh cut can
  // celebrate again). Subsequent mounts (tab switches) render the completed
  // state statically, without replaying the animation.
  const celebrateKey = `liftos_cut_celebrated_${e.goalWeight.toFixed(1)}`;
  const [justCelebrated] = useState(() => {
    if (!isComplete) return false;
    if (localStorage.getItem(celebrateKey)) return false;
    localStorage.setItem(celebrateKey, "1");
    return true;
  });

  return (
    <button
      type="button"
      ref={ref}
      data-inview={inView}
      className={`page-card goal${isComplete ? " is-complete" : ""}${justCelebrated ? " is-celebrating" : ""}`}
      onClick={onNav}
    >
      <div className="goal-head">
        <span className="goal-label">{isComplete ? "Goal reached" : "Cut Progress"}</span>
        <span className="goal-pct">{pctCount}%</span>
      </div>
      <div className="goal-bar">
        <div className="goal-bar-fill" style={{ width: `${barPct}%` }} />
      </div>
      <div className="goal-detail">
        <div className="goal-row">
          <div className="goal-col-label">Goal</div>
          <MetricValue size="md" unit="kg">{e.goalWeight.toFixed(1)}</MetricValue>
          <div className="goal-sub">{e.targetBodyFat}% body fat</div>
        </div>
        <div className="goal-divider" aria-hidden />
        <div className="goal-row">
          <div className="goal-col-label">Remaining</div>
          <MetricValue size="md" unit="kg">{e.remainingWeight.toFixed(1)}</MetricValue>
        </div>
      </div>
      <p className="goal-basis">Based on 30-day lean mass &amp; 14-day body-fat averages.</p>
    </button>
  );
}

// One-time initializer: pins the starting line for the current cut. Shown ONLY
// while no baseline exists (target set but cut_start_date null); after Save it
// never appears again. The chosen date's smoothed body composition is snapshotted
// into config and progress reads that persisted value — it is never recomputed.
// Deliberately NOT today's date — the user picks when this cut actually began,
// so the months already behind them still count. No restart / reset / cancel:
// to begin a new cut, edit nutrition_config.cut_start_* directly.
function CutBaselineCard({ metrics, onSaved }: { metrics: BodyMetric[]; onSaved: () => void }) {
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = date ? cutBaselineAt(metrics, date) : null;
  const canSave = !!date && preview?.bodyFatPct != null;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveCutBaseline(date, metrics);
      onSaved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setSaving(false);
    }
  }

  return (
    <div className="page-card goal goal-init">
      <div className="goal-head">
        <span className="goal-label">Cut Progress</span>
      </div>
      <p className="goal-init-lede">
        Set when this cut began. Progress is measured from that fixed point, so the
        months already behind you still count.
      </p>
      <label className="goal-init-field">
        <span>Cut start date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {date && (
        <p className="goal-init-preview">
          {preview?.bodyFatPct != null
            ? `Baseline: ${preview.bodyFatPct.toFixed(1)}% body fat${
                preview.weightKg != null ? ` · ${preview.weightKg.toFixed(1)} kg` : ""
              }`
            : "No readings near that date — pick a date with body-fat data."}
        </p>
      )}
      <button type="button" className="goal-init-save" onClick={handleSave} disabled={!canSave || saving}>
        {saving ? "Saving…" : "Create baseline"}
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}

/* ── Weight Card ───────────────────────────────────────────────────────── */

// Weight answers one question: am I losing at the right rate? Latest weight +
// the smoothed weekly trend + a one-word pace read. The trend/status come from
// the shared evaluation (single weight-trend source) — no point-to-point delta.
function WeightCard({
  weightLatest,
  metrics,
  state,
  cutStartDate,
  onNav,
}: {
  weightLatest: number | null;
  metrics: BodyMetric[];
  state: NutritionStateFull | null;
  cutStartDate: string | null;
  onNav: () => void;
}) {
  // observedRate is a real 0-fallback when no trend could be fit (<5 readings in
  // the window). Present that as "—" rather than a fabricated "±0.00 kg/week".
  const trend =
    state != null && state.diagnostics.weightDataPoints >= MIN_TREND_POINTS
      ? state.evaluation.observedRate
      : null;
  const status = state ? paceLabel(state.evaluation) : null;
  const tone = state ? paceTone(state.evaluation) : null;
  const { ref, inView } = useInView<HTMLButtonElement>();

  // Same 7-day-vs-previous-7-day comparison as the Health page's Weight card.
  const weightPts = series(metrics, "weight_kg");
  const thisWeek = rollingAvg(weightPts, 7, 0);
  const prevWeek = rollingAvg(weightPts, 7, 7);
  const weightDelta = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;

  if (weightLatest == null) {
    return (
      <button type="button" ref={ref} data-inview={inView} className="page-card ov-weight ov-weight--empty" onClick={onNav}>
        <div className="ov-weight-head">
          <span className="ov-weight-label">Weight</span>
          <span className="ov-weight-chevron" aria-hidden>›</span>
        </div>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          No weight data yet — sync from Apple Health.
        </p>
      </button>
    );
  }

  return (
    <button type="button" ref={ref} data-inview={inView} className="page-card ov-weight" onClick={onNav}>
      <div className="ov-weight-head">
        <span className="ov-weight-label">Weight</span>
        <span className="ov-weight-chevron" aria-hidden>›</span>
      </div>
      <div className="ov-weight-stat">
        <MetricValue size="md" unit="kg">
          {weightLatest}
        </MetricValue>
        <MetricDelta value={weightDelta} decimals={1} unit="kg" />
      </div>
      <div className="ov-weight-rows">
        <div className="ov-weight-row">
          <span className="ov-weight-key">Trend</span>
          <span className="ov-weight-val">{trend != null ? fmtTrend(trend) : "—"}</span>
        </div>
        <div className="ov-weight-row">
          <span className="ov-weight-key">Status</span>
          <span className={`ov-weight-val${tone ? ` is-${tone}` : ""}`}>
            {status ?? "—"}
            {cutStartDate && ` ${fmtDaysSince(cutStartDate)}`}
          </span>
        </div>
      </div>
    </button>
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
  const { ref, inView } = useInView<HTMLDivElement>();
  const hasData = strength.total > 0;
  const retentionPct = compoundProgress ? Math.round(compoundProgress.overall * 100) : null;
  const retCount = useCountUp(inView ? (retentionPct ?? 0) : 0, 600);
  const attention = strength.watch;

  // Attention always sits above On Track and is ordered worst-first (steepest
  // recent decline, i.e. lowest trend), so the most urgent exercise reads first.
  const watchExercises = strength.exercises
    .filter((e) => e.status === "watch")
    .sort((a, b) => a.trend - b.trend);
  // On Track is ordered worst-first (lowest % of PR), so the exercises
  // closest to needing attention read first.
  const onTrackExercises = strength.exercises
    .filter((e) => e.status !== "watch")
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));

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
    <div ref={ref} data-inview={inView} className={`page-card ov-training-health${expanded ? " is-expanded" : ""}`}>
      {/* Tapping the header navigates to Training (matches Weight·TDEE's
          whole-card-navigates pattern) — expand/collapse is the dedicated
          "{N} more on track" toggle below, not this header. */}
      <button type="button" className="ov-th-summary" onClick={onNav}>
        <div className="ov-th-top">
          <span className="ov-th-label">Training Health</span>
          <span className="ov-th-chevron" aria-hidden>›</span>
        </div>

        <div className="ov-th-ret-hero">
          <MetricValue size="md">{retentionPct !== null ? `${retCount}%` : "—"}</MetricValue>
          <MetricCaption>of tracked lifts on track</MetricCaption>
        </div>

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
              {onTrackExercises.map((ex) => (
                <ExerciseRow key={ex.slug} exercise={ex} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Recovery Card ─────────────────────────────────────────────────────── */

// Compact mirror of the Health tab's Recovery card: status word + the three
// signals against their recovery baseline + the shared one-line insight. No
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
      <span className="ov-rec-metric-row">
        <MetricValue size="md" unit={value != null ? unit : undefined}>
          {value != null ? fmt(value) : "—"}
        </MetricValue>
        <span className="ov-rec-metric-delta-slot">
          <MetricDelta value={delta} higherBetter={higherBetter} decimals={decimals} />
        </span>
      </span>
    </div>
  );
}

function RecoveryCard({ snap, onNav }: { snap: RecoverySnapshot | null; onNav: () => void }) {
  const { ref, inView } = useInView<HTMLButtonElement>();
  if (!snap || !snap.status) {
    return (
      <button type="button" ref={ref} data-inview={inView} className="page-card ov-recovery ov-recovery--empty" onClick={onNav}>
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
    <button type="button" ref={ref} data-inview={inView} className="page-card ov-recovery" onClick={onNav}>
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

  const load = () =>
    fetchOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));

  useEffect(() => {
    void load();
  }, [activity]);

  usePageHeader({ eyebrow: fmtTopbarDate(), title: greeting(user), onCopy: copyAllData });

  if (error && !data) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={() => { setError(null); void load(); }} />
      </div>
    );
  }

  return (
    <div className="page">
      {/* Cold-load skeleton — real card structure with placeholder values so
          the page never shows a blank gap under the header while data loads. */}
      {!data && (
        <>
          <div className="page-card ov-weight loading-card">
            <div className="ov-weight-head">
              <span className="ov-weight-label">Weight</span>
              <span className="ov-weight-chevron" aria-hidden>›</span>
            </div>
            <MetricValue size="md" unit="kg">00.0</MetricValue>
            <div className="ov-weight-rows">
              <div className="ov-weight-row">
                <span className="ov-weight-key">Trend</span>
                <span className="ov-weight-val">−0.00 kg/wk</span>
              </div>
              <div className="ov-weight-row">
                <span className="ov-weight-key">Status</span>
                <span className="ov-weight-val">On pace</span>
              </div>
            </div>
          </div>

          <div className="page-card ov-training-health loading-card">
            <div className="ov-th-summary">
              <div className="ov-th-top">
                <span className="ov-th-label">Training Health</span>
                <span className="ov-th-chevron" aria-hidden>›</span>
              </div>
              <div className="ov-th-ret-hero">
                <MetricValue size="md">00%</MetricValue>
                <MetricCaption>of tracked lifts on track</MetricCaption>
              </div>
            </div>
            <div className="ov-th-status">
              <span className="ov-th-all-good">All exercises on track</span>
            </div>
          </div>

          <div className="page-card ov-recovery loading-card">
            <div className="ov-rec-head">
              <span className="ov-rec-title">Recovery</span>
              <span className="ov-rec-status">Ready</span>
            </div>
            <div className="ov-rec-metrics">
              <RecoveryMetric label="Sleep" value={0} unit="h" decimals={1} delta={null} higherBetter />
              <RecoveryMetric label="HRV" value={0} unit="ms" decimals={0} delta={null} higherBetter />
              <RecoveryMetric label="RHR" value={0} unit="bpm" decimals={0} delta={null} higherBetter={false} />
            </div>
          </div>
        </>
      )}

      {data?.nutritionState?.recommendation && (
        <SystemCard rec={data.nutritionState.recommendation} onNav={(tab) => nav(tab)} />
      )}

      {data && data.targetBodyFat != null && data.cutStartDate == null ? (
        <CutBaselineCard metrics={data.metrics} onSaved={() => void load()} />
      ) : (
        data?.goal && <CutProgressCard goal={data.goal} onNav={() => nav("health")} />
      )}

      {data && (
        <WeightCard
          weightLatest={data.weightLatest}
          metrics={data.metrics}
          state={data.nutritionState}
          cutStartDate={data.cutStartDate}
          onNav={() => nav("health")}
        />
      )}

      {data && (
        <TrainingHealthCard
          strength={data.strength}
          compoundProgress={data.compoundProgress}
          onNav={() => nav("training")}
        />
      )}

      {data && <RecoveryCard snap={data.recovery} onNav={() => nav("health")} />}
    </div>
  );
}
