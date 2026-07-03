import { useEffect, useState, type Ref, type ReactNode } from "react";
import { fetchOverview, saveCutBaseline, type OverviewData } from "./api";
import { cutBaselineAt } from "./goal";
import type { BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import { series, rollingAvg } from "@features/health/math";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useInView } from "@shared/hooks/useInView";
import { progressColor, progressGradient } from "@shared/lib/progressColor";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { ActivityRing } from "@shared/components/ActivityRing";
import "@shared/components/activityRing.css";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { useSettingsSheet } from "@app/layout/SettingsSheetContext";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { useSessionUser } from "@app/layout/SessionContext";
import type { NutritionStateFull } from "@features/nutrition/evaluationApi";
import { MIN_TREND_POINTS } from "@features/nutrition/evaluation";
import { paceLabel, paceTone, cutEtaLabel } from "@features/nutrition/recommendation";
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

function daysSince(isoDate: string): number {
  const start = new Date(isoDate + "T12:00:00");
  return Math.round((Date.now() - start.getTime()) / 86400000);
}

/** Days since the current cut began, as "(141 d)" — appended after a *conclusive*
 *  pace word (On/Below/Above pace) so Weight answers "how long have I held this
 *  rate?" without a separate row. Mirrors Cut Progress's baseline. An
 *  inconclusive read ("Forming"/"Calibrating") carries no day count — just the
 *  word itself. */
function fmtDaysSince(isoDate: string): string {
  return `(${daysSince(isoDate)} d)`;
}

/* ── Active Target Card ────────────────────────────────────────────────── */

// Renders the ring at a given accrued value (blank number + empty fill when
// `shown` is null, i.e. before the roll starts). `innerRef` goes on the ring
// centre so its on-screen position can be measured for the stagger.
function ActiveTargetRingBody({ shown, target, innerRef }: { shown: number | null; target: number; innerRef?: Ref<HTMLDivElement> }) {
  const ratio = (shown ?? 0) / Math.max(1, target);
  // Fixed accent while open — this card is near-binary (a training day closes
  // it, a rest day doesn't), so a continuous ramp just flickers without
  // signaling anything. Flips once to --good on close, a discrete celebration.
  const ringColor = ratio >= 1 ? "var(--good)" : "var(--accent)";
  return ratio > 1 ? (
    <OverflowRing ratio={ratio} size={96} strokeWidth={9}>
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className="ov-active-target-ring-num">{shown == null ? "" : shown.toLocaleString()}</span>
        <span className="ov-active-target-ring-of">of {target.toLocaleString()}</span>
      </div>
    </OverflowRing>
  ) : (
    <ActivityRing pct={ratio} size={96} strokeWidth={9} color={ringColor} trackColor="var(--bg-soft)" transition="none">
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className="ov-active-target-ring-num">{shown == null ? "" : shown.toLocaleString()}</span>
        <span className="ov-active-target-ring-of">of {target.toLocaleString()}</span>
      </div>
    </ActivityRing>
  );
}

// Past 100%, draw a second lap layered on the same track/radius instead of
// re-coloring or nesting a smaller ring — reads as "stacked on top", not a
// state change. Specific to Active Target; every other ring consumer keeps
// the base component's clamp-at-1 behavior.
function OverflowRing({
  ratio,
  size,
  strokeWidth,
  children,
}: {
  ratio: number;
  size: number;
  strokeWidth: number;
  children?: ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const overflowLength = Math.min(1, ratio - 1) * circumference;
  return (
    <div className="activity-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--good)" strokeWidth={strokeWidth} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="var(--good)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${overflowLength} ${circumference}`}
          transform={`rotate(-90 ${c} ${c})`}
          style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.65))" }}
        />
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}

function ActiveTargetRingRoll({ accrued, target, delayMs }: { accrued: number; target: number; delayMs: number }) {
  const shown = useCountUp(accrued, COUNT_UP_MS, 0, delayMs);
  return <ActiveTargetRingBody shown={shown} target={target} />;
}

/* Today's-target ring: the accrued number counts up from 0 and the ring fills in
   step with it (both derive from the same tween), staggered bottom-up by the
   ring's on-screen position. It measures a blank ring first (carrying the ref)
   so the roll only starts once its delay is known. Remounted on tab-enter via an
   activity key so it replays each time you return to Overview. */
function ActiveTargetRing({ accrued, target }: { accrued: number; target: number }) {
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  if (delayMs == null) return <ActiveTargetRingBody shown={null} target={target} innerRef={ref} />;
  return <ActiveTargetRingRoll accrued={accrued} target={target} delayMs={delayMs} />;
}

/* Active Target — back-solves the daily active-calorie goal from a maintenance
   TDEE target (target − resting), then tracks this week's pace against it. The
   whole card is derived from the latest synced metrics, so it re-computes on
   every sync without any stored state. The goal itself is edited from
   Settings (single source of truth, shared with Nutrition) — this card only
   ever shows current TDEE against it for comparison; tapping the chip jumps
   to Settings rather than editing inline. */
function ActiveTargetCard({
  view,
  targetTdee,
  currentTdee,
}: {
  view: ActiveTargetView | null;
  targetTdee: number | null;
  currentTdee: number | null;
}) {
  const { openSettings } = useSettingsSheet();
  // Overview's first card: the ring re-rolls on every tab-enter (activity key),
  // while every card below animates only on first load.
  const activity = useTabActivity();

  // Not configured yet — a one-tap invitation, no empty scaffolding.
  if (targetTdee == null) {
    return (
      <section className="page-card ov-active-target">
        <div className="page-eyebrow" style={{ margin: 0 }}>Active target</div>
        <button type="button" className="ov-active-target-setup" onClick={openSettings}>
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
  const ratio = view ? view.today.accrued / Math.max(1, view.today.target) : 0;
  const isClosed = view ? view.today.accrued >= view.today.target : false;

  return (
    <section className="page-card ov-active-target">
      <div className="ov-active-target-head">
        <span className="page-eyebrow" style={{ margin: 0 }}>Active target</span>
        <button type="button" className="ov-active-target-goal" onClick={openSettings}>
          {currentTdee != null ? `${currentTdee.toLocaleString()} / ` : ""}
          {targetTdee.toLocaleString()} TDEE
        </button>
      </div>

      {view ? (
        <>
          <div className="ov-active-target-ring-row">
            <ActiveTargetRing
              key={activity}
              accrued={view.today.accrued}
              target={view.today.target}
            />
            <div className="ov-active-target-ring-caption">
              <span className="ov-active-target-ring-title">Today's target</span>
              <span className="ov-active-target-ring-sub">
                {ratio > 1.05
                  ? `Closed — ${Math.round(ratio * 100)}% of today's target`
                  : position === "behind"
                    ? <><span className="is-behind">Behind</span> this week — today's up from your {dailyAvg.toLocaleString()}/day average</>
                    : position === "ahead"
                      ? <><span className="is-ahead">Ahead</span> this week — today eased below your {dailyAvg.toLocaleString()}/day average</>
                      : <><span className="is-on">On pace</span> — about your {dailyAvg.toLocaleString()}/day average</>}
              </span>
              {!view.today.synced && (
                <span className="ov-active-target-ring-stale">
                  {view.today.lastSyncDate
                    ? `Not synced today — last reading ${view.today.lastSyncDate}`
                    : "Not synced yet"}
                </span>
              )}
            </div>
          </div>

          <div className={`ov-active-target-hint${isClosed ? " is-closed" : ""}`}>
            {isClosed ? (
              <>
                <span>Today's ring is closed</span>
                <span>{view.today.accrued.toLocaleString()} active logged</span>
              </>
            ) : (
              <>
                <span>{(view.today.target - view.today.accrued).toLocaleString()} kcal to close today's ring</span>
                {view.session && (
                  <span>A typical session adds ~{view.session.boost.toLocaleString()} active</span>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <p className="page-note">
          No resting-energy baseline yet — the target needs a few days of Apple Health data.
        </p>
      )}
    </section>
  );
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

// The % and the bar are split into their own leaves so they can be keyed by
// activity and re-roll on tab-enter WITHOUT remounting the card (which would
// re-fire its rise-in entrance and read as a jump). They roll from 0 each time.
function GoalPctRoll({ target, delayMs }: { target: number; delayMs: number }) {
  const pct = useCountUp(target, COUNT_UP_MS, 0, delayMs);
  // The % is a hero number that HAS a progress bar, so it takes the bar's
  // colour rather than a semantic verdict: the ramp colour at this fill (gold
  // once complete), matching the bar's leading edge.
  const color =
    pct == null ? undefined
    : pct >= 100 ? "var(--progress-complete)"
    : progressColor(pct / 100);
  return (
    <span className="goal-pct" style={color ? { color } : undefined}>
      {pct == null ? "" : `${pct}%`}
    </span>
  );
}

function GoalPct({ target }: { target: number }) {
  // Measure a blank span first (carries the ref) so the roll starts from 0 only
  // once its bottom-up delay is known — the delay overlaps the tab slide-in, so
  // the % isn't already part-way up by the time the card is on screen.
  const { ref, delayMs } = useBottomUpDelay<HTMLSpanElement>();
  if (delayMs == null) return <span ref={ref} className="goal-pct" />;
  return <GoalPctRoll target={target} delayMs={delayMs} />;
}

function GoalBarFill({ target, gradient }: { target: number; gradient: string }) {
  // Sit at 0 until the bottom-up delay elapses, then grow to target so the CSS
  // width transition fires. The delay overlaps the tab slide-in, so the bar
  // starts filling from empty as the card lands (not already part-way).
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  const [w, setW] = useState(0);
  useEffect(() => {
    if (delayMs == null) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setW(target));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, target]);
  // Anchor the ember→green spectrum to the full track (not to the fill itself),
  // so the fill's leading edge always shows the spectrum colour at the current
  // %: low progress reads ember, and it greens as the goal is approached. The
  // fill is w% of the track, so sizing its background to (100/w) of its own
  // width = 100% of the track. Guard w→0 (fill is invisible then).
  const barFillSize = w > 0 ? `${(10000 / w).toFixed(1)}% 100%` : "100% 100%";
  return (
    <div
      ref={ref}
      className="goal-bar-fill"
      style={{
        width: `${w}%`,
        backgroundImage: gradient,
        backgroundSize: barFillSize,
        // Match the % count-up (COUNT_UP_MS, ease-out quart) so the bar and the
        // number finish together instead of the bar racing ahead.
        transition: `width ${COUNT_UP_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`,
      }}
    />
  );
}

// Answers one question only: "how far am I from my destination?" A single
// merged Goal line (goal weight · target body fat) plus what's left to lose.
// Pure render — every number is finished upstream in computeGoal (the Goal
// provider); the card holds no business logic. Deliberately does NOT show
// current weight or trend: that's the Weight card's job ("where am I today,
// and am I progressing at the planned rate?"). Responsibilities stay distinct.
function CutProgressCard({
  goal,
  cutStartDate,
  state,
  onNav,
}: {
  goal: Goal;
  cutStartDate: string | null;
  state: NutritionStateFull | null;
  onNav: () => void;
}) {
  const e = goal.evaluation;
  const pct = Math.round(e.progressPct);
  const eta = state
    ? cutEtaLabel(state.evaluation, state.diagnostics.weightDataPoints, e.remainingWeight)
    : null;
  const isComplete = pct >= 100;
  const cutDay = cutStartDate ? daysSince(cutStartDate) : null;
  // Overview's first card: the % and bar re-roll from 0 on every tab-enter
  // (the leaves are keyed by activity, so only they remount — not the card, so
  // its rise-in entrance never re-fires). Honors reduced-motion (snaps).
  const { ref, inView } = useInView<HTMLButtonElement>();
  const activity = useTabActivity();

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
        <span className="goal-label">
          {isComplete ? "Goal reached" : "Cut Progress"}
          {!isComplete && cutDay != null && (
            <span className="goal-day">
              {" "}
              · Day <b>{cutDay}</b>
            </span>
          )}
        </span>
        <GoalPct key={activity} target={pct} />
      </div>
      <div className="goal-bar">
        <GoalBarFill key={activity} target={pct} gradient={progressGradient()} />
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
          {eta && <div className="goal-sub">{eta}</div>}
        </div>
      </div>
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

// Weight card carries two layers on purpose: the green down-good delta (this
// week's drop — the direct "it's moving the right way" signal, same as Health)
// AND the pace read (Trend rate + Status), which answers the deeper "am I losing
// at the *right rate*". They can differ — down but slow reads green delta + gold
// "Below pace" — and that pairing is the point, not a contradiction.
function WeightCard({
  weightLatest,
  metrics,
  state,
  cutStartDate,
  onNav,
  onNavActivity,
}: {
  weightLatest: number | null;
  metrics: BodyMetric[];
  state: NutritionStateFull | null;
  cutStartDate: string | null;
  onNav: () => void;
  onNavActivity: () => void;
}) {
  // observedRate is a real 0-fallback when no trend could be fit (<5 readings in
  // the window). Present that as "—" rather than a fabricated "±0.00 kg/week".
  const trend =
    state != null && state.diagnostics.weightDataPoints >= MIN_TREND_POINTS
      ? state.evaluation.observedRate
      : null;
  const status = state ? paceLabel(state.evaluation) : null;
  const tone = state ? paceTone(state.evaluation) : null;
  // Only a conclusive verdict (tone set) carries the cut baseline day count; an
  // inconclusive read ("Forming"/"Calibrating") is just the word, no suffix.
  const { ref, inView } = useInView<HTMLDivElement>();

  // 7-day average vs the prior 7 days — same signal the Health weight card
  // shows; down = good on a cut. Threshold-suppressed when within noise.
  const weightPts = series(metrics, "weight_kg");
  const thisWeek = rollingAvg(weightPts, 7, 0);
  const prevWeek = rollingAvg(weightPts, 7, 7);
  const weightDelta = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;

  if (weightLatest == null) {
    return (
      <div
        role="button"
        tabIndex={0}
        ref={ref}
        data-inview={inView}
        className="page-card ov-weight ov-weight--empty"
        onClick={onNav}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNav();
          }
        }}
      >
        <div className="ov-weight-head">
          <span className="ov-weight-label">Weight</span>
          <span className="ov-weight-chevron" aria-hidden>›</span>
        </div>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          No weight data yet — sync from Apple Health
        </p>
      </div>
    );
  }

  // The top half (label + latest weight) opens Health — "where am I today".
  // The bottom half (Trend/Status/Activity rows) is the pace read, which is
  // Nutrition's territory (it's driven by the calorie target), so it jumps
  // there instead. The outer element can't be a native <button> (nested
  // buttons are invalid HTML); it's a div with the same role/keyboard
  // behavior, and the rows block is the one real nested <button> that stops
  // its click from also firing onNav.
  return (
    <div
      role="button"
      tabIndex={0}
      ref={ref}
      data-inview={inView}
      className="page-card ov-weight"
      onClick={onNav}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNav();
        }
      }}
    >
      <div className="ov-weight-head">
        <span className="ov-weight-label">Weight</span>
        <span className="ov-weight-chevron" aria-hidden>›</span>
      </div>
      <div className="ov-weight-stat">
        <MetricValue size="lg" unit="kg">
          {weightLatest}
        </MetricValue>
        <MetricDelta value={weightDelta} direction="down-good" decimals={1} unit="kg" />
      </div>
      <button
        type="button"
        className="ov-weight-rows ov-weight-rows--nav"
        onClick={(e) => {
          e.stopPropagation();
          onNavActivity();
        }}
      >
        <div className="ov-weight-row">
          <span className="ov-weight-key">Rate</span>
          <span className="ov-weight-val">
            {trend != null ? fmtTrend(trend) : "—"}
          </span>
        </div>
        <div className="ov-weight-row">
          <span className="ov-weight-key">Status</span>
          <span className={`ov-weight-val${tone ? ` is-${tone}` : ""}`}>
            {status ?? "—"}
            {tone && cutStartDate && ` ${fmtDaysSince(cutStartDate)}`}
          </span>
        </div>
      </button>
    </div>
  );
}

/* ── Training Health Card ──────────────────────────────────────────────── */

// On-track rows show "% of all-time PR" (how close to your best). Flagged
// (watch) rows instead carry a stalled readout counting whole weeks since
// the last new best — that's what actually earned the flag, and it reads
// clearer than a % that could look like a contradiction (e.g. "97% · Review").
function exerciseRetention(ex: import("./api").StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

function fmtStalledReadout(weeks: number): { value: string; label: string } {
  if (weeks < 1) return { value: "PR", label: "this wk" };
  return { value: `${weeks}`, label: weeks === 1 ? "wk stalled" : "wks stalled" };
}

function AttentionRow({ exercise }: { exercise: import("./api").StrengthExercise }) {
  const stalled = fmtStalledReadout(exercise.stalledWeeks);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-dot" aria-hidden />
      <span className="ov-th-row-name">{exercise.name}</span>
      <span className="ov-th-row-stalled">
        <span className="ov-th-row-stalled-val">{stalled.value}</span>{" "}
        <span className="ov-th-row-stalled-label">{stalled.label}</span>
      </span>
    </div>
  );
}

function OnTrackRow({ exercise }: { exercise: import("./api").StrengthExercise }) {
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-name">{exercise.name}</span>
      <span className="ov-th-row-pct">{retPct}%</span>
    </div>
  );
}

// Overview is a status snapshot, not the exercise list — even expanded, a
// section only teases the first few; anyone wanting the full list has
// Training for that (see onNav on the "+more" row below).
const EXERCISE_ROW_LIMIT = 5;
// On-track overflows far more often (most lifts are on track), so it's
// capped tighter — the fold body stays reassurance-sized, not a full list.
const ON_TRACK_ROW_LIMIT = 3;

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
  const retCount = useCountUp(inView ? (retentionPct ?? 0) : 0);
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
          Log 4+ sessions per exercise to unlock training health
        </p>
      </button>
    );
  }

  return (
    <div ref={ref} data-inview={inView} className={`page-card ov-training-health${expanded ? " is-expanded" : ""}`}>
      {/* Tapping the header navigates to Training (matches Weight·TDEE's
          whole-card-navigates pattern) — expand/collapse is the dedicated
          fold trigger below, not this header. */}
      <button type="button" className="ov-th-summary" onClick={onNav}>
        <div className="ov-th-top">
          <span className="ov-th-label">Training Health</span>
          <span className="ov-th-chevron" aria-hidden>›</span>
        </div>

        <div className="ov-th-ret-hero">
          {/* Hero % is a ratio, not an identity metric/delta/verdict — stays
              neutral ink, no good/bad coloring (color law). */}
          <MetricValue size="xl">
            {retentionPct !== null ? (retCount == null ? "" : `${retCount}%`) : "—"}
          </MetricValue>
          <span className="ov-th-ret-count">
            {onTrackExercises.length} of {strength.total} lifts on track
          </span>
        </div>

        {/* Segmented ratio bar — visual read of on-track vs attention that
            doesn't depend on expanding the fold below. */}
        <div
          className="ov-th-bar"
          role="img"
          aria-label={`${onTrackExercises.length} of ${strength.total} lifts on track`}
        >
          {strength.exercises.map((ex, i) => (
            <span
              key={ex.slug}
              className={`ov-th-bar-seg${i < onTrackExercises.length ? " is-good" : ""}`}
            />
          ))}
        </div>
      </button>

      {/* Single fold controls both Attention and On Track together, so the
          collapsed card height never depends on how many lifts are flagged
          or tracked — this row stands in for the whole detail list. */}
      <button
        type="button"
        className="ov-th-fold"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="ov-th-fold-left">
          {attention > 0 && (
            <>
              <span className="ov-th-fold-chip">{attention}</span>
              <span className="ov-th-fold-text">need attention</span>
              {!expanded && <span className="ov-th-fold-sep" aria-hidden>·</span>}
            </>
          )}
          {!expanded && (
            <span className="ov-th-fold-text ov-th-fold-text--muted">
              {onTrackExercises.length} on track
            </span>
          )}
        </span>
        <svg
          className={`ov-th-fold-chevron${expanded ? " is-open" : ""}`}
          width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {expanded && (
        <div className="ov-th-fold-body">
          {watchExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head-row">
                <span className="ov-th-sect-head">Attention</span>
                <span className="ov-th-count-chip">{watchExercises.length}</span>
              </div>
              {watchExercises.slice(0, EXERCISE_ROW_LIMIT).map((ex) => (
                <AttentionRow key={ex.slug} exercise={ex} />
              ))}
              {watchExercises.length > EXERCISE_ROW_LIMIT && (
                <button type="button" className="ov-th-show-more" onClick={onNav}>
                  +{watchExercises.length - EXERCISE_ROW_LIMIT} more in Training
                </button>
              )}
            </div>
          )}
          {onTrackExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head-row">
                <span className="ov-th-sect-head">On track · {onTrackExercises.length}</span>
              </div>
              {onTrackExercises.slice(0, ON_TRACK_ROW_LIMIT).map((ex) => (
                <OnTrackRow key={ex.slug} exercise={ex} />
              ))}
              {onTrackExercises.length > ON_TRACK_ROW_LIMIT && (
                <button type="button" className="ov-th-show-more" onClick={onNav}>
                  +{onTrackExercises.length - ON_TRACK_ROW_LIMIT} more in Training
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
            <MetricValue size="lg" unit="kg">00.0</MetricValue>
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
                <MetricValue size="xl">00%</MetricValue>
                <MetricCaption>of tracked lifts on track</MetricCaption>
              </div>
              <div className="ov-th-bar" aria-hidden>
                {Array.from({ length: 15 }).map((_, i) => (
                  <span key={i} className="ov-th-bar-seg is-good" />
                ))}
              </div>
            </div>
            <div className="ov-th-fold">
              <span className="ov-th-fold-left">
                <span className="ov-th-fold-text ov-th-fold-text--muted">Loading…</span>
              </span>
            </div>
          </div>
        </>
      )}

      {data?.nutritionState?.recommendation && (
        <SystemCard rec={data.nutritionState.recommendation} onNav={(tab) => nav(tab)} />
      )}

      {/* Active Target — leads: the actionable "what do I do today" number. */}
      {data && (
        <ActiveTargetCard
          view={data.activeTarget}
          targetTdee={data.targetTdee}
          currentTdee={data.currentTdee}
        />
      )}

      {data && data.targetBodyFat != null && data.cutStartDate == null ? (
        <CutBaselineCard metrics={data.metrics} onSaved={() => void load()} />
      ) : (
        data?.goal && (
          <CutProgressCard
            goal={data.goal}
            cutStartDate={data.cutStartDate}
            state={data.nutritionState}
            onNav={() => nav("health")}
          />
        )
      )}

      {data && (
        <WeightCard
          weightLatest={data.weightLatest}
          metrics={data.metrics}
          state={data.nutritionState}
          cutStartDate={data.cutStartDate}
          onNav={() => nav("health")}
          onNavActivity={() => nav("nutrition", { scrollTo: "nutrition-insight-card" })}
        />
      )}

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
