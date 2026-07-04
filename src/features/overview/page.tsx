import { useEffect, useId, useState, type Ref, type ReactNode } from "react";
import { fetchOverview, saveCutBaseline, type OverviewData } from "./api";
import { cutBaselineAt } from "./goal";
import type { BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import { series, rollingAvg } from "@features/health/math";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useInView } from "@shared/hooks/useInView";
import { progressColor } from "@shared/lib/progressColor";
import { MetricValue, MetricDelta } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import { StrengthHealthCard } from "@features/training/StrengthHealthCard";
import { ActivityRing } from "@shared/components/ActivityRing";
import { AnimatedNumber } from "@shared/components/AnimatedNumber";
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

/* ── Active Target Card ────────────────────────────────────────────────── */

// Renders the ring at a given accrued value (blank number + empty fill when
// `shown` is null, i.e. before the roll starts). `innerRef` goes on the ring
// centre so its on-screen position can be measured for the stagger.
function ActiveTargetRingBody({ shown, target, synced = true, innerRef }: { shown: number | null; target: number; synced?: boolean; innerRef?: Ref<HTMLDivElement> }) {
  const ratio = (shown ?? 0) / Math.max(1, target);
  // Absence ≠ a measured zero: before today syncs, the centre reads "—", not "0".
  const numText = shown == null ? "" : !synced ? "—" : shown.toLocaleString();
  // Follows the shared Apple-spectrum progress ramp by fill (progressColor) —
  // red→orange→green→cyan→blue, the same as the Cut Progress bar and top-bar
  // ring. At/over 100% it flips to the discrete completion gold
  // (--progress-complete), never a ramp stop.
  const ringColor = ratio >= 1 ? "var(--progress-complete)" : progressColor(ratio);
  return ratio > 1 ? (
    <OverflowRing ratio={ratio} size={96} strokeWidth={9} color={ringColor}>
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className="ov-active-target-ring-num">{numText}</span>
        <span className="ov-active-target-ring-of">of {target.toLocaleString()}</span>
      </div>
    </OverflowRing>
  ) : (
    <ActivityRing pct={ratio} size={96} strokeWidth={9} color={ringColor} trackColor="var(--bg-soft)" transition="none">
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className="ov-active-target-ring-num">{numText}</span>
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
  color,
  children,
}: {
  ratio: number;
  size: number;
  strokeWidth: number;
  color: string;
  children?: ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const overflowFrac = Math.min(1, ratio - 1);
  const overflowLength = overflowFrac * circumference;
  const tailClipId = useId();
  const bandClipId = useId();
  // Tail = the leading end of the second lap; the shadow is revealed only here.
  const tailAngle = overflowFrac * 2 * Math.PI - Math.PI / 2;
  const tailX = c + r * Math.cos(tailAngle);
  const tailY = c + r * Math.sin(tailAngle);
  // Annulus matching the ring's own stroke band (outer r+sw/2, inner r−sw/2) as
  // an even-odd path so the inner circle is a hole. Clips the tail shadow to
  // land only ON the ring — never past the outer edge nor into the inner hole.
  const rOut = r + strokeWidth / 2;
  const rIn = r - strokeWidth / 2;
  const bandPath =
    `M ${c - rOut} ${c} a ${rOut} ${rOut} 0 1 0 ${rOut * 2} 0 a ${rOut} ${rOut} 0 1 0 ${-rOut * 2} 0 Z ` +
    `M ${c - rIn} ${c} a ${rIn} ${rIn} 0 1 0 ${rIn * 2} 0 a ${rIn} ${rIn} 0 1 0 ${-rIn * 2} 0 Z`;
  // The second lap is ONE arc, drawn twice from the same props: the plain ribbon
  // on top, and a shadowed copy behind it shown only where the tail window AND
  // the ring band overlap — so the shadow lifts the ribbon's END, cast onto the
  // ring beneath, while the head continues seamlessly onto the first lap.
  const overflowArc = {
    cx: c, cy: c, r,
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeDasharray: `${overflowLength} ${circumference}`,
    transform: `rotate(-90 ${c} ${c})`,
  };
  return (
    <div className="activity-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <clipPath id={tailClipId}>
            <circle cx={tailX} cy={tailY} r={strokeWidth * 1.6} />
          </clipPath>
          <clipPath id={bandClipId}>
            <path d={bandPath} clipRule="evenodd" fillRule="evenodd" />
          </clipPath>
        </defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />
        {overflowFrac > 0 && (
          <g clipPath={`url(#${tailClipId})`}>
            <g clipPath={`url(#${bandClipId})`}>
              <circle {...overflowArc} style={{ filter: "drop-shadow(0 2.5px 3.5px rgba(0,0,0,.7))" }} />
            </g>
          </g>
        )}
        <circle {...overflowArc} />
      </svg>
      {children && <div className="activity-ring-center">{children}</div>}
    </div>
  );
}

function ActiveTargetRingRoll({ accrued, target, synced, delayMs }: { accrued: number; target: number; synced: boolean; delayMs: number }) {
  const shown = useCountUp(accrued, COUNT_UP_MS, 0, delayMs);
  return <ActiveTargetRingBody shown={shown} target={target} synced={synced} />;
}

/* Today's-target ring: the accrued number counts up from 0 and the ring fills in
   step with it (both derive from the same tween), staggered bottom-up by the
   ring's on-screen position. It measures a blank ring first (carrying the ref)
   so the roll only starts once its delay is known. Rolls ONCE on first reveal,
   then settles — a later value change (re-sync) tweens in place, no re-roll. */
function ActiveTargetRing({ accrued, target, synced }: { accrued: number; target: number; synced: boolean }) {
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  if (delayMs == null) return <ActiveTargetRingBody shown={null} target={target} synced={synced} innerRef={ref} />;
  return <ActiveTargetRingRoll accrued={accrued} target={target} synced={synced} delayMs={delayMs} />;
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
  onNav,
}: {
  view: ActiveTargetView | null;
  targetTdee: number | null;
  currentTdee: number | null;
  onNav: () => void;
}) {
  const { openSettings } = useSettingsSheet();

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

  return (
    <button type="button" className="page-card ov-active-target" onClick={onNav}>
      <div className="ov-active-target-head">
        <span className="page-eyebrow" style={{ margin: 0 }}>Active target</span>
        <span className="ov-active-target-goal">
          {currentTdee != null ? `${currentTdee.toLocaleString()} / ` : ""}
          {targetTdee.toLocaleString()} TDEE
        </span>
      </div>

      {view ? (
        <>
          <div className="ov-active-target-ring-row">
            <ActiveTargetRing
              accrued={view.today.accrued}
              target={view.today.target}
              synced={view.today.synced}
            />
            <div className="ov-active-target-ring-caption">
              <span className="ov-active-target-ring-title">Today's active target</span>
              <span className="ov-active-target-ring-sub">
                {ratio > 1.05
                  ? `Closed — ${Math.round(ratio * 100)}% of target`
                  : position === "behind"
                    ? <><span className="is-behind">Behind</span> this week — raised from your <span className="ov-active-target-avg-muted">{dailyAvg.toLocaleString()}/day baseline</span></>
                    : position === "ahead"
                      ? <><span className="is-ahead">Ahead</span> this week — eased below your <span className="ov-active-target-avg-muted">{dailyAvg.toLocaleString()}/day baseline</span></>
                      : <><span className="is-on">On pace</span> — about your <span className="ov-active-target-avg-muted">{dailyAvg.toLocaleString()}/day baseline</span></>}
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

        </>
      ) : (
        <p className="page-note">
          No resting-energy baseline yet — the target needs a few days of Apple Health data.
        </p>
      )}
    </button>
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

// The % and the bar are split into their own leaves so the roll/fill logic is
// isolated from the card. They roll from 0 ONCE on first reveal, then settle —
// a later value change (re-sync) tweens in place, matching every other number
// in the app (no per-tab-enter re-roll).
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

function GoalBarFill({ target }: { target: number }) {
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
  // A SOLID fill whose colour IS the ramp point at the current fill — a warm→cool
  // Apple spectrum (red→orange→green→cyan→blue) as the goal is approached (gold at
  // 100% flips via the .is-complete CSS override). NOT a gradient smeared across
  // the track: the whole fill is one colour that shifts WITH progress. Derived
  // from w, so as the bar grows the colour tweens along the spectrum toward blue
  // alongside the width (both share COUNT_UP_MS) — matching the % number's count-up.
  return (
    <div
      ref={ref}
      className="goal-bar-fill"
      style={{
        width: `${w}%`,
        backgroundColor: progressColor(w / 100),
        // Match the % count-up (COUNT_UP_MS, ease-out quad) so the bar and the
        // number finish together instead of the bar racing ahead.
        transition: `width ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1), background-color ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`,
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
  // Day into the *current* phase. daysOnTarget counts trailing days at the active
  // target (0 = became active today), so +1 makes today read as "Day 1".
  const phaseDay = state ? state.diagnostics.daysOnTarget + 1 : null;
  const showPhase = phaseDay != null;
  // The % and bar roll/fill from 0 once on first reveal, then settle — see
  // GoalPctRoll. Honors reduced-motion (snaps).
  const { ref, inView } = useInView<HTMLButtonElement>();

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
              {showPhase ? (
                <>· Day <b>{phaseDay}</b> / {cutDay}</>
              ) : (
                <>· Day <b>{cutDay}</b></>
              )}
            </span>
          )}
        </span>
        <GoalPct target={pct} />
      </div>
      <div className="goal-bar">
        <GoalBarFill target={pct} />
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
// Full-width 14-day weight trend line. Line-only (no beads/labels) to keep the
// Health-tab minimalism, but stretched edge-to-edge as the card's dominant
// element. Smoothing stays honest — raw daily readings from `series`, same
// source the Health weight card uses; no new interpolation (bucketSeries stays
// pure). preserveAspectRatio="none" stretches the 100×64 viewBox to fill the
// card width while non-scaling-stroke keeps the line a constant 2px.
const WEIGHT_SPARK_MIN_SPAN = 1; // kg — floor so a flat week doesn't fill height

function WeightSparkline({ values, tone }: { values: number[]; tone: "good" | "bad" | "flat" }) {
  const stroke = tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : "var(--ink-4)";
  const gradId = `ov-spark-grad-${tone}`;
  const W = 100, H = 64, pad = 4;

  // Not enough data: hold the 64px height with a flat dashed placeholder so the
  // card never changes height between loading / empty / loaded (layout stability).
  if (values.length < 2) {
    const y = (H / 2).toFixed(1);
    return (
      <svg className="ov-weight-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <line
          x1={pad} y1={y} x2={W - pad} y2={y}
          stroke="var(--ink-4)" strokeWidth="1.75" strokeLinecap="round"
          strokeDasharray="2 4" vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...values), max = Math.max(...values);
  const center = (min + max) / 2;
  const half = Math.max(max - min, WEIGHT_SPARK_MIN_SPAN) / 2;
  const lo = center - half;
  const span = half * 2 || 1;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - lo) / span) * (H - pad * 2);
    return { x, y };
  });
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  // Area under the line, fading down to transparent — the line's tone tints the
  // fill. Closed along the bottom edge so the gradient reads as depth, not a band.
  const first = coords[0], last = coords[coords.length - 1];
  const area = `${pts} ${last.x.toFixed(1)},${H} ${first.x.toFixed(1)},${H}`;

  return (
    <svg className="ov-weight-spark ov-weight-spark--draw" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} stroke="none" />
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function WeightCard({
  weightLatest,
  metrics,
  state,
  onNav,
  onNavActivity,
}: {
  weightLatest: number | null;
  metrics: BodyMetric[];
  state: NutritionStateFull | null;
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

  // Last 14 daily readings — the trend shape under the number. Line tone is
  // driven by the SAME weightDelta sign as MetricDelta below (down = good on a
  // cut): direction from the number's sign, colour from the tone — kept
  // independent, matching the delta-arrow rule.
  const sparkValues = weightPts.map((p) => p.value).slice(-14);
  const sparkTone: "good" | "bad" | "flat" =
    weightDelta == null ? "flat" : weightDelta < 0 ? "good" : weightDelta > 0 ? "bad" : "flat";

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
          <AnimatedNumber
            value={weightLatest}
            decimals={1}
            format={(n) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          />
        </MetricValue>
        <MetricDelta value={weightDelta} direction="down-good" decimals={1} unit="kg" />
      </div>

      <WeightSparkline values={sparkValues} tone={sparkTone} />

      <button
        type="button"
        className="ov-weight-rows ov-weight-rows--nav ov-weight-rows--single"
        onClick={(e) => {
          e.stopPropagation();
          onNavActivity();
        }}
      >
        <span className="ov-weight-rate">
          <span className="ov-weight-key">Rate</span>{" "}
          <span className="ov-weight-val">{trend != null ? fmtTrend(trend) : "—"}</span>
        </span>
        <span className={`ov-weight-status-pill${tone ? ` is-${tone}` : ""}`}>
          <span className="ov-weight-status-dot" />
          {status ?? "—"}
        </span>
      </button>
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
          {/* Active target — leads the loaded layout, so leads the skeleton. */}
          <section className="page-card ov-active-target loading-card">
            <div className="ov-active-target-head">
              <span className="page-eyebrow" style={{ margin: 0 }}>Active target</span>
              <span className="ov-active-target-goal">0,000 / 0,000 TDEE</span>
            </div>
            <div className="ov-active-target-ring-row">
              <ActiveTargetRingBody shown={null} target={0} />
              <div className="ov-active-target-ring-caption">
                <span className="ov-active-target-ring-title">Today's active target</span>
                <span className="ov-active-target-ring-sub">Loading…</span>
              </div>
            </div>
          </section>

          {/* Cut Progress — mirrors CutProgressCard's goal markup. */}
          <div className="page-card goal loading-card">
            <div className="goal-head">
              <span className="goal-label">Cut Progress</span>
              <span className="goal-pct">00%</span>
            </div>
            <div className="goal-bar">
              <div className="goal-bar-fill" style={{ width: 0 }} />
            </div>
            <div className="goal-detail">
              <div className="goal-row">
                <div className="goal-col-label">Goal</div>
                <MetricValue size="md" unit="kg">00.0</MetricValue>
                <div className="goal-sub">00% body fat</div>
              </div>
              <div className="goal-divider" aria-hidden />
              <div className="goal-row">
                <div className="goal-col-label">Remaining</div>
                <MetricValue size="md" unit="kg">0.0</MetricValue>
              </div>
            </div>
          </div>

          {/* Weight — sparkline + single Rate/Status row, matching WeightCard. */}
          <div className="page-card ov-weight loading-card">
            <div className="ov-weight-head">
              <span className="ov-weight-label">Weight</span>
              <span className="ov-weight-chevron" aria-hidden>›</span>
            </div>
            <div className="ov-weight-stat">
              <MetricValue size="lg" unit="kg">00.0</MetricValue>
            </div>
            <WeightSparkline values={[]} tone="flat" />
            <div className="ov-weight-rows ov-weight-rows--single">
              <span className="ov-weight-rate">
                <span className="ov-weight-key">Rate</span>{" "}
                <span className="ov-weight-val">−0.00 kg/wk</span>
              </span>
              <span className="ov-weight-status-pill">
                <span className="ov-weight-status-dot" />
                On pace
              </span>
            </div>
          </div>

          {/* Training Health — mirrors StrengthHealthCard variant="snapshot". */}
          <div className="page-card ov-training-health loading-card">
            <div className="ov-th-top">
              <span className="ov-th-label">Training Health</span>
              <span className="ov-th-chevron" aria-hidden>›</span>
            </div>
            <div className="ov-th-ret-hero">
              <MetricValue size="lg">00%</MetricValue>
              <span className="ov-th-ret-count">0 of 0 tracked lifts on track</span>
            </div>
            <div className="ov-th-bar" aria-hidden>
              {Array.from({ length: 15 }).map((_, i) => (
                <span key={i} className="ov-th-bar-seg is-good" />
              ))}
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
          onNav={() => nav("health", { scrollTo: "health-energy-card" })}
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
          onNav={() => nav("health")}
          onNavActivity={() => nav("nutrition", { scrollTo: "nutrition-insight-card" })}
        />
      )}

      {data && (
        <StrengthHealthCard
          variant="snapshot"
          strength={data.strength}
          onNav={() => nav("training", { scrollTo: "training-strength-health-card" })}
        />
      )}
    </div>
  );
}
