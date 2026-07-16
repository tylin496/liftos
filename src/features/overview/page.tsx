import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { fetchOverview, saveCutBaseline, saveBulkBaseline, type OverviewData } from "./api";
import { cutBaselineAt } from "./goal";
import type { BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import { series, rollingAvg, trailingAvg, latestUpdatedAt } from "@features/health/math";
import { isStale, formatAgo } from "@shared/lib/freshness";
import { FreshnessTag } from "@shared/components/FreshnessTag";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { progressColor } from "@shared/lib/progressColor";
import { displayNameFor } from "@shared/lib/owner";
import { localDateStr } from "@shared/lib/date";
import { haptic } from "@shared/lib/haptics";
import { CLEAR_AFTER_MOVE } from "@shared/lib/motion";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import { MetricValue, MetricDelta } from "@shared/components/Metric";
import { Badge } from "@shared/components/Badge";
import { ErrorState } from "@shared/components/ErrorState";
import { StrengthHealthCard } from "@features/training/StrengthHealthCard";
import { ActivityRing, OverflowRing } from "@shared/components/ActivityRing";
import { HeadlineCountUp } from "@shared/components/AnimatedNumber";
import "@shared/components/activityRing.css";
import { PageTopBar } from "@shared/components/PageTopBar";
import { useSettingsSheet } from "@app/layout/SettingsSheetContext";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { scrollRevealClear } from "@app/layout/revealScroll";
import { useSessionUser, useIsReadOnly } from "@app/layout/SessionContext";
import type { NutritionStateFull } from "@features/nutrition/evaluationApi";
import { dismissRecoveryDirective } from "@features/nutrition/evaluationApi";
import { MIN_TREND_POINTS } from "@features/nutrition/evaluation";
import { paceLabel, paceTone, rateTone, cutEtaLabel } from "@features/nutrition/recommendation";
import { CONSIDER_ENTER_COUNT, type Recommendation } from "@features/overview/recommendations";
import type { Goal, BulkGoal, GoalStatusEvaluation, BulkGoalStatusEvaluation } from "./goal";
import { phaseKindFromName, phaseDirection, weightMetricDirection } from "@features/nutrition/logic";
import type { PhaseTriggerResult } from "./phaseTriggers";
import type { TabId } from "@app/layout/TabBar";
import {
  fmtTopbarDate, shiftISODays, fmtWeekRange, fmtDayLabel, daysSince, fmt1kg, greeting,
} from "./format";
import {
  activeTargetPosition, weekActiveTotal, weekBanked, bankedTone, weekStripCells,
  phasePlanNote, cutStageLabel, bulkStageLabel, weightLineTone, accelArrowTone, buildSparkGeometry,
  SPARK_W, SPARK_H, SPARK_PAD,
} from "./derive";
import "./overview.css";

const copyAllData = () => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS);

/* ── Active Target Card ────────────────────────────────────────────────── */

// Renders the ring at a given accrued value (blank number + empty fill when
// `shown` is null, i.e. before the roll starts). `innerRef` goes on the ring
// centre so its on-screen position can be measured for the stagger.
function ActiveTargetRingBody({ shown, target, synced = true, innerRef }: { shown: number | null; target: number; synced?: boolean; innerRef?: Ref<HTMLDivElement> }) {
  const ratio = (shown ?? 0) / Math.max(1, target);
  // Hero number tracks the ring's own state in lock-step with the tween:
  //   below 100% — how much is left to CLOSE the ring, counting DOWN (target→0);
  //   at 100%    — "✓", the ring is closed;
  //   over 100%  — the fill percentage ("140%"), the number the ring now carries.
  // Absence ≠ a measured zero: before today syncs the centre reads "—", not "0".
  const remaining = Math.max(0, Math.round(target - (shown ?? 0)));
  const over = ratio > 1;
  const numText =
    shown == null
      ? ""
      : !synced
        ? "—"
        : over
          ? `${Math.round(ratio * 100)}%`
          : remaining > 0
            ? remaining.toLocaleString()
            : "✓";
  const subText =
    shown == null
      ? ""
      : !synced
        ? `of ${target.toLocaleString()}`
        : over
          ? "of goal"
          : remaining > 0
            ? "left"
            : "Closed";
  // Follows the shared Apple-spectrum progress ramp by fill (progressColor) —
  // red→orange→green→cyan→blue. At/over 100% it settles on --good, matching the
  // "Closed" status word and the week-strip bars: closing the daily active
  // target is a routine win, so it is NOT gold — gold stays reserved for the
  // rare Cut-goal celebration.
  const ringColor = ratio >= 1 ? "var(--good)" : progressColor(ratio);
  return ratio > 1 ? (
    <OverflowRing ratio={ratio} size={72} strokeWidth={7} color={ringColor}>
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className={`ov-active-target-ring-num${over ? " is-over" : ""}`}>{numText}</span>
        <span className="ov-active-target-ring-of">{subText}</span>
      </div>
    </OverflowRing>
  ) : (
    <ActivityRing pct={ratio} size={72} strokeWidth={7} color={ringColor} transition="none">
      <div className="ov-active-target-ring-center" ref={innerRef}>
        <span className={`ov-active-target-ring-num${over ? " is-over" : ""}`}>{numText}</span>
        <span className="ov-active-target-ring-of">{subText}</span>
      </div>
    </ActivityRing>
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
// 7-cell Mon→Sun proportion strip under the ring row — past days show how much
// of that day's active target was actually logged, today rides the same fill
// ratio (and colour) as the ring, future days sit empty. Reads the raw metrics
// rows directly (same Mon-start week `computeActiveTarget` filters) rather
// than adding per-day state — this is the only consumer.
function ActiveTargetWeekStrip({
  view,
  metrics,
  mondayISO,
  selected,
  onSelectDate,
}: {
  view: ActiveTargetView;
  metrics: BodyMetric[];
  /** Monday of the week the card is currently browsing (may be a past week). */
  mondayISO: string;
  /** Resolved (never-null) day the ring is pinned to — highlighted in the strip. */
  selected: string;
  onSelectDate: (date: string) => void;
}) {
  // Each bar follows the same spectrum ramp as the ring, BUT a met day reads
  // --good green here, not the ring's completion gold: the ring is the ONE gold
  // spot on the card, so a whole row of gold bars doesn't dilute it (gold stays
  // rare). Below-target days still ride the ramp. (See weekStripCells.)
  const cells = weekStripCells(view, metrics, mondayISO, localDateStr());

  // Fills draw in from empty ON the flat --enter-wait beat — the SAME clock the
  // ring count-up uses — so the whole week appears alongside the day's number
  // rolling, not on its own wave. Deliberately NOT a left-to-right stagger (that
  // would be a 5th sanctioned cascade); all seven grow together, sharing the
  // count-up bezier (ease-out quad mirror) like the Nutrition intake rail.
  // One state flip → the CSS transitions carry every frame; re-renders on week
  // change just re-transition the fills to their new widths.
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (delayMs == null) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setShown(true));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  const fillRamp = `width ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`;

  return (
    <div className="ov-active-target-week" ref={ref}>
      {cells.map((c) => {
        const isSel = c.kind !== "future" && selected === c.date;
        return (
          <button
            key={c.date}
            type="button"
            className="ov-active-target-week-cell"
            disabled={c.kind === "future"}
            aria-pressed={isSel}
            onClick={(e) => {
              e.stopPropagation();
              onSelectDate(c.date);
            }}
          >
            <div
              className={`ov-active-target-week-bar is-${c.kind}${isSel ? " is-selected" : ""}`}
              style={isSel && c.ringColor ? ({ "--week-glow": c.ringColor } as CSSProperties) : undefined}
            >
              {c.kind !== "future" && (
                <div
                  className="ov-active-target-week-fill"
                  style={{
                    width: shown ? `${Math.round(c.fill * 100)}%` : 0,
                    backgroundColor: c.ringColor,
                    transition: fillRamp,
                  }}
                />
              )}
            </div>
            <span className={`ov-active-target-week-day is-${c.kind}${isSel ? " is-selected" : ""}`}>
              {c.letter}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveTargetCard({
  view,
  targetTdee,
  currentTdee,
  syncAt,
  metrics,
  onNav,
  loading = false,
}: {
  view: ActiveTargetView | null;
  targetTdee: number | null;
  currentTdee: number | null;
  /** updated_at of the latest active-energy reading — the tag's same-day clock. */
  syncAt?: string | null;
  /** Raw metrics rows — only used for the week strip's per-day fill. */
  metrics: BodyMetric[];
  onNav: () => void;
  loading?: boolean;
}) {
  const { openSettings } = useSettingsSheet();
  // null = viewing the browsed week's anchor day (today for the current week,
  // the same weekday for a past week); a concrete ISO date pins the ring/status
  // to a day the user tapped in the strip instead.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 0 = current week; −n = n weeks back. Swipe (or the tab remount) moves this.
  const [weekOffset, setWeekOffset] = useState(0);
  // Slide-direction class for the card remount; clears after the slide so the
  // next nav replays it (mirrors nutrition's week-strip carousel).
  const [weekNavDir, setWeekNavDir] = useState<"forward" | "backward" | null>(null);
  // Outer wrapper owns the swipe (stable across week changes); the inner card
  // remounts (key) and slides the new week through on commit.
  const weekRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const weekCommitted = useRef(false);

  const todayISO = localDateStr();
  const isCurrentWeek = weekOffset === 0;
  // Monday of the browsed week, derived from the live current-week Monday.
  const viewedMonday = view ? shiftISODays(view.mondayISO, weekOffset * 7) : null;
  // Browse back only while there's older active-energy data to land on.
  const canGoBack =
    viewedMonday != null &&
    metrics.some((m) => m.metric_date < viewedMonday && m.active_energy_kcal != null);

  function navigateWeek(dir: "forward" | "backward") {
    if (dir === "forward" && isCurrentWeek) return; // nothing past the current week
    if (dir === "backward" && !canGoBack) return; // no older data to show
    haptic("select");
    weekCommitted.current = true;
    setWeekNavDir(dir);
    setSelectedDate(null); // new week opens on its own anchor day
    setWeekOffset((o) => o + (dir === "forward" ? 1 : -1));
  }

  // Whole card follows the finger/cursor 1:1; rubber-band at the edges, and the
  // hook stops the gesture bubbling to Shell's tab-swipe (see tab-navigation
  // skill). dir 1 = swiped left = forward (toward this week); −1 = back a week.
  useHorizontalSwipe(weekRef, (d) => navigateWeek(d === 1 ? "forward" : "backward"), {
    pointer: true,
    onDrag: (dx) => {
      const el = cardRef.current;
      if (!el) return;
      const atEdge = (dx < 0 && isCurrentWeek) || (dx > 0 && !canGoBack);
      const offset = atEdge ? Math.sign(dx) * Math.min(72, Math.abs(dx) * 0.2) : dx;
      el.style.transition = "none";
      el.style.transform = `translateX(${offset}px)`;
    },
    onDragEnd: () => {
      const el = cardRef.current;
      if (!el) return;
      if (weekCommitted.current) {
        // Committed: the card remounts (key) and plays slide-in — clear the drag
        // transform instantly so it doesn't fight the animation.
        weekCommitted.current = false;
        el.style.transition = "none";
        el.style.transform = "";
      } else {
        el.style.transition = "transform var(--dur-exit) var(--ease-snap)";
        el.style.transform = "";
      }
    },
  });

  useEffect(() => {
    if (!weekNavDir) return;
    const t = window.setTimeout(() => setWeekNavDir(null), CLEAR_AFTER_MOVE);
    return () => window.clearTimeout(t);
  }, [weekNavDir]);

  // Cold load — mirrors the loaded DOM (a <div> root, head + ring inside a
  // .ov-active-target-navblock button, the week strip, then a second navblock
  // button around the footer) so React updates the SAME nodes in place. The old
  // skeleton used a <button> root, which can't reconcile into the loaded <div>
  // root — every load remounted the card and replayed its entrance.
  if (loading) {
    return (
      <div ref={weekRef}>
      <div className="page-card ov-active-target loading-card">
        <button type="button" className="ov-active-target-navblock" onClick={onNav}>
          <div className="ov-active-target-head">
            <span className="page-eyebrow" style={{ margin: 0 }}>Active target</span>
            <div className="ov-active-target-head-right">
              <span className="ov-active-target-chevron" aria-hidden>›</span>
            </div>
          </div>
          <div className="ov-active-target-ring-row">
            <ActiveTargetRingBody shown={null} target={0} />
            <div className="ov-active-target-ring-body">
              <span className="ov-active-target-status">Loading…</span>
              <span className="ov-active-target-detail">Loading…</span>
            </div>
          </div>
        </button>
        <div className="ov-active-target-week" aria-hidden>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="ov-active-target-week-cell">
              <div className="ov-active-target-week-bar is-future" />
              <span className="ov-active-target-week-day is-future">&nbsp;</span>
            </div>
          ))}
        </div>
        <button type="button" className="ov-active-target-navblock" onClick={onNav}>
          <div className="ov-active-target-footer">
            <span className="ov-active-target-banked is-neutral">Loading…</span>
            <span className="ov-active-target-goal">0,000 / 0,000 TDEE</span>
          </div>
        </button>
      </div>
      </div>
    );
  }

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
  // On-pace → today.target == the flat daily average; behind → higher, ahead →
  // lower. A ±30 kcal deadband keeps it from flickering near equality.
  const position = view ? activeTargetPosition(view.today.target, dailyAvg) : "on";
  const ratio = view ? view.today.accrued / Math.max(1, view.today.target) : 0;

  // Footer balance. Current week: the live "through yesterday vs flat pace"
  // running figure the floating target is built from. A past (completed) week:
  // its final full-week total vs the 7-day goal — a retrospective settle.
  const pastWeekTotal =
    view && !isCurrentWeek && viewedMonday ? weekActiveTotal(metrics, viewedMonday) : 0;
  const banked = view ? weekBanked(view, isCurrentWeek, pastWeekTotal) : 0;
  const banktone = bankedTone(banked);

  // The week's anchor day — today for the current week, the same weekday N weeks
  // back otherwise ("last week's today"). The ring lands here after a swipe;
  // tapping the strip overrides it (selectedDate).
  const anchorDay = isCurrentWeek ? todayISO : shiftISODays(todayISO, weekOffset * 7);
  const effSelected = selectedDate ?? anchorDay;
  // The floating "today" ring is a live-day-only concept; every other day (a
  // tapped past day, or any day of a past week) shows the fixed per-day ring.
  const isViewingToday = isCurrentWeek && effSelected === todayISO;
  const viewingPastDay = view != null && !isViewingToday;
  // Past days have no floating target (that folds the week's pace into what's
  // left) — measure against the flat per-day goal, the week-strip's denominator.
  const pastDayAccrued = viewingPastDay
    ? Math.round(metrics.find((m) => m.metric_date === effSelected)?.active_energy_kcal ?? 0)
    : 0;
  const pastDaySynced = viewingPastDay
    ? metrics.some((m) => m.metric_date === effSelected && m.active_energy_kcal != null)
    : false;
  const pastDayRatio = view ? pastDayAccrued / Math.max(1, view.activeTargetPerDay) : 0;
  const pastDayLabel = viewingPastDay ? fmtDayLabel(effSelected) : "";

  return (
    <div ref={weekRef}>
    <div
      ref={cardRef}
      key={viewedMonday ?? "cur"}
      className={`page-card ov-active-target${weekNavDir === "forward" ? " week-nav-forward" : weekNavDir === "backward" ? " week-nav-backward" : ""}`}
    >
      <button type="button" className="ov-active-target-navblock" onClick={onNav}>
        <div className="ov-active-target-head">
          <span className="page-eyebrow" style={{ margin: 0 }}>Active target</span>
          <div className="ov-active-target-head-right">
            {isCurrentWeek ? (
              <FreshnessTag date={view?.today.lastSyncDate ?? null} kind="sync" updatedAt={syncAt} />
            ) : viewedMonday ? (
              // A past week: the sync clock is meaningless — orient with the
              // week's date range instead.
              <span className="ov-active-target-weeklabel">{fmtWeekRange(viewedMonday)}</span>
            ) : null}
            <span className="ov-active-target-chevron" aria-hidden>›</span>
          </div>
        </div>

        {view ? (
          <div className="ov-active-target-ring-row">
            <ActiveTargetRing
              accrued={viewingPastDay ? pastDayAccrued : view.today.accrued}
              target={viewingPastDay ? view.activeTargetPerDay : view.today.target}
              synced={viewingPastDay ? pastDaySynced : view.today.synced}
            />
            <div className="ov-active-target-ring-body">
              {viewingPastDay ? (
                <>
                  <span className="ov-active-target-status">{pastDayLabel}</span>
                  <span className="ov-active-target-detail">
                    {pastDaySynced ? (
                      <>
                        <span className="ov-active-target-mono">{pastDayAccrued.toLocaleString()}</span> /{" "}
                        <span className="ov-active-target-num">{view.activeTargetPerDay.toLocaleString()}</span> active
                        {" · "}
                        {Math.round(pastDayRatio * 100)}%
                      </>
                    ) : (
                      "No active-energy reading synced"
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="ov-active-target-status">
                    {ratio > 1.05
                      ? <><span className="is-closed">Closed</span> — {Math.round(ratio * 100)}% of target</>
                      : position === "behind"
                        ? <><span className="is-behind">Behind</span> this week</>
                        : position === "ahead"
                          ? <><span className="is-ahead">Ahead</span> this week</>
                          : <><span className="is-on">On pace</span> this week</>}
                  </span>
                  {/* Detail line states the floating target explicitly, with its
                      cause (this week's pace vs the flat baseline) — replaces the
                      old "about your baseline" restatement that never named a
                      number. Target value is the one bolded figure; usual/logged
                      stay plain mono. */}
                  <span className="ov-active-target-detail">
                    {ratio > 1.05 ? (
                      <>Above your <span className="ov-active-target-mono">{dailyAvg.toLocaleString()}</span> baseline · <span className="ov-active-target-mono">{view.today.accrued.toLocaleString()}</span> logged</>
                    ) : position === "behind" ? (
                      <>Raised to <span className="ov-active-target-num">{view.today.target.toLocaleString()}</span> (usual <span className="ov-active-target-mono">{dailyAvg.toLocaleString()}</span>) · <span className="ov-active-target-mono">{view.today.accrued.toLocaleString()}</span> logged</>
                    ) : position === "ahead" ? (
                      <>Eased to <span className="ov-active-target-num">{view.today.target.toLocaleString()}</span> (usual <span className="ov-active-target-mono">{dailyAvg.toLocaleString()}</span>) · <span className="ov-active-target-mono">{view.today.accrued.toLocaleString()}</span> logged</>
                    ) : (
                      <>Today <span className="ov-active-target-num">{view.today.target.toLocaleString()}</span> — your usual pace · <span className="ov-active-target-mono">{view.today.accrued.toLocaleString()}</span> logged</>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="page-note">
            No resting-energy baseline yet — the target needs a few days of Apple Health data.
          </p>
        )}
      </button>

      {view && (
        <>
          <ActiveTargetWeekStrip
            view={view}
            metrics={metrics}
            mondayISO={viewedMonday ?? view.mondayISO}
            selected={effSelected}
            onSelectDate={(date) => setSelectedDate(date === anchorDay ? null : date)}
          />

          <button type="button" className="ov-active-target-navblock" onClick={onNav}>
            <div className="ov-active-target-footer">
              <span className={`ov-active-target-banked is-${banktone}`}>
                {banktone !== "neutral" && <span className="ov-active-target-banked-dot" aria-hidden />}
                {banktone === "good"
                  ? `+${banked.toLocaleString()} banked ${isCurrentWeek ? "this" : "that"} week`
                  : banktone === "warn"
                    ? `${banked.toLocaleString()} short ${isCurrentWeek ? "this" : "that"} week`
                    : `on pace ${isCurrentWeek ? "this" : "that"} week`}
              </span>
              <span className="ov-active-target-goal">
                {currentTdee != null ? `${currentTdee.toLocaleString()} / ` : ""}
                {targetTdee.toLocaleString()} TDEE
              </span>
            </div>
          </button>
        </>
      )}
    </div>
    </div>
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
  // Maintenance directives resolve by moving the calorie plan → Nutrition.
  phase: "nutrition",
};

function SystemCard({
  rec,
  closing,
  onNav,
  onDismiss,
}: {
  rec: Recommendation;
  /** True while the banner plays its collapse-out exit (see .ov-system-collapse). */
  closing?: boolean;
  onNav: (tab: TabId) => void;
  onDismiss?: () => void;
}) {
  // Command center: only surface the card when there's something to act on.
  // "No action needed" means nothing to do, so the whole banner (and its
  // divider) disappears rather than sitting there confirming nothing's wrong.
  if (rec.title === "No action needed") return null;
  // A dismissible directive (only a systemic recovery dip — sick/travel the app
  // can't infer) splits the banner: the body still navigates, and a subordinate
  // ✕ snoozes it. Nested buttons are invalid, so the container is a plain div.
  const canDismiss = rec.dismissible && onDismiss != null;
  // Wrapper is the .page > * flex item so it carries the entrance rise-in AND
  // owns the collapse-out: on dismiss/clear the parent keeps it mounted through
  // --dur-exit (useExitTransition) while .is-closing grid-collapses + fades it,
  // so the cards below glide up instead of the banner hard-cutting away.
  return (
    <div className={`ov-system-collapse${closing ? " is-closing" : ""}`}>
      <div className="page-card ov-system-banner">
        <button type="button" className="ov-system-main" onClick={() => onNav(REC_TAB[rec.source])}>
          <span className="ov-system-dot" />
          <span className="ov-system-body">
            <span className="ov-system-title">{rec.title}</span>
            <span className="ov-system-sub">{rec.subtitle}</span>
          </span>
          {!canDismiss && <span className="ov-system-chevron" aria-hidden>›</span>}
        </button>
        {canDismiss && (
          <button
            type="button"
            className="ov-system-dismiss"
            onClick={onDismiss}
            aria-label="I know why — snooze this until I'm training again"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Cut Progress Card ─────────────────────────────────────────────────── */

// The % and the bar are split into their own leaves so the roll/fill logic is
// isolated from the card. They roll from 0 ONCE on first reveal, then settle —
// a later value change (re-sync) tweens in place, matching every other number
// in the app (no per-tab-enter re-roll).
function GoalPctRoll({ target, delayMs }: { target: number; delayMs: number }) {
  const pct = useCountUp(target, COUNT_UP_MS, 0, delayMs);
  // The % is a hero number carried in neutral ink — the bar itself shows the
  // fill/ramp, so the number reads as a plain readout rather than competing with
  // it. Gold once complete stays (celebration), matching the bar's finished state.
  const color =
    pct == null ? undefined
    : pct >= 100 ? "var(--progress-complete)"
    : "var(--ink)";
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

function GoalTrack({
  target,
  currentWeight,
  startWeight,
  goalWeight,
}: {
  target: number;
  /** The 7-day smoothed current weight — rides the Now tag as a position readout
   *  ("you are here, at 91.7 kg"), NOT a trend (that stays the Weight card's job).
   *  Labelled "Now" not "Today": it's a smoothed average, not a same-day reading. */
  currentWeight: number;
  startWeight: number | null;
  goalWeight: number;
}) {
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
  //
  // The fill, the Today dot and its tag all derive from the same w and share the
  // count-up bezier (ease-out quad mirror), so the dot rides the fill's leading
  // edge instead of arriving on its own clock. The tag's left is clamped so it
  // can't half-exit the card at either end (the dot itself may — that's the
  // "you are at the start line" read).
  const ramp = `${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`;
  const color = progressColor(w / 100);
  return (
    <div ref={ref} className="goal-track">
      <span
        className="goal-today"
        style={{ left: `clamp(30px, ${w}%, calc(100% - 30px))`, transition: `left ${ramp}` }}
      >
        Now · {currentWeight.toFixed(1)} kg
      </span>
      <div className="goal-path">
        <div className="goal-bar">
          <div
            className="goal-bar-fill"
            style={{
              width: `${w}%`,
              backgroundColor: color,
              transition: `width ${ramp}, background-color ${ramp}`,
            }}
          />
        </div>
        <div
          className="goal-dot"
          style={{
            left: `${w}%`,
            backgroundColor: color,
            // --dot-core feeds the beacon halo in CSS (the near-white ring +
            // soft ramp-coloured glow that gives the "you are here" marker its
            // weight). Kept as a var so the .goal.is-complete gold-glow override
            // still wins by selector specificity at 100%.
            ["--dot-core" as string]: color,
            transition: `left ${ramp}, background-color ${ramp}`,
          }}
        />
      </div>
      {/* Endpoint signposts under the route's two ends — the departure and
          destination weights, replacing the old 3-column detail block. */}
      <div className="goal-signposts">
        <span className="goal-signpost">
          Start <b>{startWeight != null ? startWeight.toFixed(1) : "—"}</b>
        </span>
        <span className="goal-signpost">
          <b>{goalWeight.toFixed(1)}</b> Goal
        </span>
      </div>
    </div>
  );
}

// A one-second read of the cut, framed as a JOURNEY not a meter, answering four
// questions top-to-bottom: where am I now (hero %, Today dot + weight), how far
// have I come (Down X kg), how far is left (remaining kg + ETA), am I on track
// (pace verdict word). A dashed route from Start to Goal with a dot at today's
// position; the endpoint weights anchor the ends of the track. Pure render —
// every number is finished upstream in computeGoal (the Goal provider) and the
// nutrition engine; the card holds no business logic. The Today tag now carries
// the current weight as a POSITION readout ("you are here, at 91.7 kg"); trend
// and rate stay the Weight card's job — responsibilities stay distinct.
// The long-term roadmap + its early-exit monitor, folded into the Journey card
// (a plan is part of the journey, not a card of its own). Collapsed by default;
// the reveal holds the three-stage plan (Cut → Maintenance 4–6 wk → Lean Bulk),
// a one-line read of where the plan stands, and the plateau-trigger lights —
// the SAME evaluatePhaseTriggers result the Decision Engine consumed, so the
// lights can never disagree with the SystemCard directive.
function PhasePlanSection({
  phase,
  goalStatus,
  bulkGoalStatus,
  cutMode,
}: {
  phase: PhaseTriggerResult;
  goalStatus: GoalStatusEvaluation;
  bulkGoalStatus: BulkGoalStatusEvaluation | null;
  cutMode: string | null;
}) {
  const [open, setOpen] = useState(false);
  // The roadmap sits mid-card, so expanding it can push the reveal behind the
  // floating tab bar. scrollRevealClear scrolls it just clear of the bar — in
  // the same motion as the expand, and only when it would be occluded. Opening
  // only; must be called while still collapsed so it can measure the grow.
  const revealRef = useRef<HTMLDivElement>(null);

  // Phase stays derived from the live deficit (phaseFromDeficit → kind): a
  // deficit is the Cut stage, the deadband is Maintenance, a surplus is the
  // Lean Bulk stage — the waypoint dot walks the road with the intake.
  const kind = phaseKindFromName(cutMode ?? "");
  const atMaintenance = kind === "maintenance";
  const atBulk = kind === "bulk";
  const n = phase.firingCount;

  // One-line read, in priority order mirroring the engine's ladder (see
  // phasePlanNote). Deliberately nothing more — the Journey card already answers
  // "where am I" and "is it going well"; this section only answers "what's the
  // road ahead and when should the plan change". No week counters, no numbers.
  const note = phasePlanNote(kind, goalStatus, bulkGoalStatus, n, phase.triggers.length, CONSIDER_ENTER_COUNT);
  const cutLabel = cutStageLabel(goalStatus.targetBodyFatPct);
  const bulkLabel = bulkStageLabel(bulkGoalStatus?.bfCeilingPct ?? null);

  return (
    <div className="goal-plan">
      <button
        type="button"
        className="goal-plan-head"
        onClick={() => setOpen((o) => { if (!o) scrollRevealClear(revealRef.current); return !o; })}
        aria-expanded={open}
      >
        {/* Section heading + always-visible subtitle: even collapsed, the row
            says what's inside (Cut → Maintenance → Lean Bulk) so it reads as
            the plan, not an anonymous accordion. */}
        <span className="goal-plan-heading">
          <span className="goal-plan-title">Roadmap</span>
          <span className="goal-plan-subtitle">Cut → Maintenance → Lean Bulk</span>
        </span>
        {!atMaintenance && n > 0 && (
          // Cut AND bulk both watch the lights; only maintenance mutes the flag
          // (its "signals" are the plan working as intended).
          <span className="goal-plan-flag">{n} signal{n === 1 ? "" : "s"} on</span>
        )}
        <span className={`goal-plan-chevron${open ? " open" : ""}`} aria-hidden>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <polyline points="4 6 8 10 12 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div ref={revealRef} className={`goal-plan-reveal${open ? " open" : ""}`}>
        <div className="goal-plan-body">
          {/* Vertical waypoint list — reads as the journey's road, not a
              breadcrumb: filled dot = you are here, hollow = ahead. */}
          <ol className="goal-plan-stages">
            <li className={`goal-plan-step${atMaintenance || atBulk ? " is-done" : " is-current"}`}>
              <span className="goal-plan-step-dot" aria-hidden />{cutLabel}
            </li>
            <li className={`goal-plan-step${atMaintenance ? " is-current" : atBulk ? " is-done" : ""}`}>
              <span className="goal-plan-step-dot" aria-hidden />Maintenance{" "}
              <span className="goal-plan-step-sub">4–6 wk</span>
            </li>
            <li className={`goal-plan-step${atBulk ? " is-current" : ""}`}>
              <span className="goal-plan-step-dot" aria-hidden />{bulkLabel}
            </li>
          </ol>
          <p className={`goal-plan-note${note.tone}`}>{note.text}</p>
          {/* Status lights only — dot + name, no readings. The evidence lives
              in the title tooltip; anything more turns this into a dashboard.
              Only auto-tracked signals appear; mental fatigue (untracked in the
              app) is intentionally omitted rather than shown as a dead light. */}
          <ul className="goal-plan-triggers">
            {phase.triggers.map((t) => (
              <li key={t.key} className="goal-plan-chip" data-state={t.state} title={t.detail}>
                <span className="goal-plan-dot" aria-hidden />
                {t.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CutProgressCard({
  goal,
  cutStartDate,
  cutStartWeight,
  weightLatestDate,
  state,
  phase,
  goalStatus,
  bulkGoalStatus = null,
  onNav,
  loading = false,
}: {
  goal?: Goal | null;
  cutStartDate: string | null;
  cutStartWeight: number | null;
  /** Date of the latest weigh-in — the "Down X kg" stat is only as current as
   *  this, so a stale reading gets an "as of N days ago" note. */
  weightLatestDate?: string | null;
  state: NutritionStateFull | null;
  phase: PhaseTriggerResult | null;
  goalStatus: GoalStatusEvaluation | null;
  /** Only feeds the roadmap's Lean Bulk stage label (the ceiling, if configured). */
  bulkGoalStatus?: BulkGoalStatusEvaluation | null;
  onNav: () => void;
  loading?: boolean;
}) {
  // Root is a div — the Plan toggle can't nest inside a button — with the
  // original content kept tappable via a reset-to-block .goal-navblock button
  // (same restructure as .ov-active-target-navblock). The % / bar reveal is
  // driven by useBottomUpDelay in the leaf rolls, not scroll-into-view.
  const e = goal?.evaluation;

  // Celebrate reaching 100% exactly once per cut (keyed by goal weight — a new
  // baseline produces a new goal weight, so a fresh cut can celebrate again).
  // Effect-driven, not a useState initializer: this card now mounts during
  // loading (goal absent), so the initializer would fire once with no data and
  // never re-arm when the completed cut finally lands. localStorage guards the
  // once-per-cut semantics; subsequent mounts render completed state statically.
  const [justCelebrated, setJustCelebrated] = useState(false);
  useEffect(() => {
    if (!e || Math.round(e.progressPct) < 100) return;
    const key = `liftos_cut_celebrated_${e.goalWeight.toFixed(1)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setJustCelebrated(true);
  }, [e]);

  if (loading) {
    return (
      <div className="page-card goal loading-card">
        <button type="button" className="goal-navblock" onClick={onNav}>
        <div className="goal-head">
          <span className="goal-label">Cut Journey</span>
          <span className="goal-head-right">
            <span className="goal-label goal-day">Day <b>000</b></span>
            <span className="goal-chevron" aria-hidden>›</span>
          </span>
        </div>
        <div className="goal-hero">
          <div className="goal-hero-left">
            <span className="goal-pct">00%</span>
            <span className="goal-complete">Complete</span>
          </div>
          <div className="goal-hero-right">
            <MetricValue size="md" unit="kg left">0.0</MetricValue>
            <div className="goal-sub">≈0 weeks</div>
          </div>
        </div>
        <div className="goal-track">
          <span className="goal-today">Now · 00.0 kg</span>
          <div className="goal-path">
            <div className="goal-bar">
              <div className="goal-bar-fill" style={{ width: 0 }} />
            </div>
            <div className="goal-dot" />
          </div>
          <div className="goal-signposts">
            <span className="goal-signpost">Start <b>00.0</b></span>
            <span className="goal-signpost"><b>00.0</b> Goal</span>
          </div>
        </div>
        <div className="goal-footer">
          <Badge pill tone="neutral">Calibrating</Badge>
          <span className="goal-sub goal-lost">Down <b>0.0</b> kg</span>
        </div>
        </button>
        {/* Collapsed Plan head placeholder — same structure/height as the loaded
            head so the card doesn't jump when data lands (layout stability). */}
        <div className="goal-plan">
          <div className="goal-plan-head">
            <span className="goal-plan-heading">
              <span className="goal-plan-title">Roadmap</span>
              <span className="goal-plan-subtitle">Cut → Maintenance → Lean Bulk</span>
            </span>
            <span className="goal-plan-chevron" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <polyline points="4 6 8 10 12 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Loaded, but no cut is configured (no body-fat target set). A quiet, static
  // placeholder — NOT the shimmer skeleton above, which has no data left to
  // resolve to and would hang forever (the original `loading || !e` conflated
  // "still loading" with "nothing to show").
  if (!e) {
    return (
      <section className="page-card goal">
        <div className="goal-head">
          <span className="goal-label">Cut Journey</span>
        </div>
        <p className="goal-sub">No active cut — set a body-fat target to start tracking progress here.</p>
      </section>
    );
  }

  const pct = Math.round(e.progressPct);
  const eta = state
    ? cutEtaLabel(state.evaluation, state.diagnostics.weightDataPoints, e.remainingWeight)
    : null;
  const isComplete = pct >= 100;
  const cutDay = cutStartDate ? daysSince(cutStartDate) : null;
  // Weight dropped since the frozen cut baseline — distance travelled, so it
  // stacks under the Start column (it describes "how far from the departure
  // point", not a stat of its own). Only shown once there's a real loss to
  // report (guards the +noise case where current briefly reads higher).
  const lost = cutStartWeight != null ? cutStartWeight - e.currentWeight : null;
  const lostStale = isStale("weight", weightLatestDate ?? null);

  // Pace verdict chip — same paceLabel/paceTone the Weight card uses (so the two
  // surfaces can never disagree), rendered through the shared <Badge pill> so
  // tone colour + gold-glow are owned in one place. tone null (Calibrating /
  // Forming / Not tracked) → neutral chip (COLOR-SYSTEM: no verdict → no verdict
  // colour). When state is null the pace chip is omitted entirely.
  const paceWord = state ? paceLabel(state.evaluation) : null;
  const tone = state ? paceTone(state.evaluation) : null;
  return (
    <div
      className={`page-card goal${isComplete ? " is-complete" : ""}${justCelebrated ? " is-celebrating" : ""}`}
    >
      <button type="button" className="goal-navblock" onClick={onNav}>
      <div className="goal-head">
        <span className="goal-label">{isComplete ? "Goal reached" : "Cut Journey"}</span>
        <span className="goal-head-right">
          {!isComplete && cutDay != null && (
            <span className="goal-label goal-day">
              Day <b>{cutDay}</b>
            </span>
          )}
          <span className="goal-chevron" aria-hidden>›</span>
        </span>
      </div>
      {/* Hero — the two headline reads: how far come (%) vs how far left (kg). */}
      <div className="goal-hero">
        <div className="goal-hero-left">
          <GoalPct target={pct} />
          <span className="goal-complete">Complete</span>
        </div>
        <div className="goal-hero-right">
          <MetricValue size="md" unit="kg left">{e.remainingWeight.toFixed(1)}</MetricValue>
          {eta && <div className="goal-sub">{eta}</div>}
        </div>
      </div>
      <GoalTrack
        target={pct}
        currentWeight={e.currentWeight}
        startWeight={cutStartWeight}
        goalWeight={e.goalWeight}
      />
      {/* Footer — pace verdict (left) vs distance travelled (right), no divider. */}
      <div className="goal-footer">
        {paceWord && (
          <Badge
            pill
            tone={tone ?? "neutral"}
            // The ONLY worded verdict on the pair — so it leads with a verdict
            // mark: ✓ when on/optimal, ! when off-band. tone null (Calibrating /
            // Forming / Not tracked) → no mark, neutral chip (no verdict colour,
            // no false glyph).
            mark={tone ? (tone === "good" || tone === "gold" ? "✓" : "!") : undefined}
          >
            {paceWord}
          </Badge>
        )}
        {lost != null && lost >= 0.1 && (
          <span className="goal-sub goal-lost">
            Down <b>{lost.toFixed(1)}</b> kg
            {lostStale && weightLatestDate && (
              <span className="goal-lost-stale"> as of {formatAgo(weightLatestDate)}</span>
            )}
          </span>
        )}
      </div>
      </button>
      {phase && goalStatus && (
        <PhasePlanSection
          phase={phase}
          goalStatus={goalStatus}
          bulkGoalStatus={bulkGoalStatus}
          cutMode={state?.diagnostics.cutMode ?? null}
        />
      )}
    </div>
  );
}

/* ── Bulk Journey (the lean-bulk twin of the cut card, same slot) ────────── */

/** Budget-used fraction at which the bar flips from neutral to warn — the
 *  approaching-the-ceiling caution, not a verdict on the day. */
const BULK_BUDGET_WARN_PCT = 80;

// The bulk's track answers a different question than the cut's: not "how far
// to the goal" (spending the fat budget is a COST, not progress) but "how much
// runway is left". So the fill is neutral ink that turns warn near the
// ceiling — never the green ramp, never gold. Same bottom-up reveal timing as
// GoalTrack so the two cards feel like siblings.
function BulkBudgetTrack({
  budgetUsedPct,
  bodyFat14dAvg,
  startBodyFat,
  bfCeiling,
}: {
  budgetUsedPct: number;
  bodyFat14dAvg: number;
  startBodyFat: number;
  bfCeiling: number;
}) {
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  const [w, setW] = useState(0);
  const target = Math.round(budgetUsedPct);
  useEffect(() => {
    if (delayMs == null) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setW(target));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, target]);
  const ramp = `${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`;
  const color = target >= BULK_BUDGET_WARN_PCT ? "var(--warn)" : "var(--ink-4)";
  return (
    <div ref={ref} className="goal-track">
      <span
        className="goal-today"
        style={{ left: `clamp(30px, ${w}%, calc(100% - 30px))`, transition: `left ${ramp}` }}
      >
        Now · {bodyFat14dAvg.toFixed(1)}% BF
      </span>
      <div className="goal-path">
        <div className="goal-bar">
          <div
            className="goal-bar-fill"
            style={{ width: `${w}%`, backgroundColor: color, transition: `width ${ramp}` }}
          />
        </div>
        <div
          className="goal-dot"
          style={{
            left: `${w}%`,
            backgroundColor: color,
            ["--dot-core" as string]: color,
            transition: `left ${ramp}`,
          }}
        />
      </div>
      <div className="goal-signposts">
        <span className="goal-signpost">
          Start <b>{startBodyFat.toFixed(1)}%</b>
        </span>
        <span className="goal-signpost">
          <b>{bfCeiling.toFixed(1)}%</b> Cap
        </span>
      </div>
    </div>
  );
}

function BulkJourneyCard({
  bulkGoal,
  bulkStartDate,
  weightLatestDate,
  state,
  phase,
  goalStatus,
  bulkGoalStatus,
  onNav,
  loading = false,
}: {
  bulkGoal: BulkGoal | null;
  bulkStartDate: string | null;
  weightLatestDate?: string | null;
  state: NutritionStateFull | null;
  phase: PhaseTriggerResult | null;
  goalStatus: GoalStatusEvaluation | null;
  bulkGoalStatus: BulkGoalStatusEvaluation | null;
  onNav: () => void;
  loading?: boolean;
}) {
  const e = bulkGoal?.evaluation;

  // Loading rides the cut card's skeleton (same slot, same shape); this branch
  // covers "phase is a bulk but the payload can't build" — a viewer before the
  // owner sets a baseline, or a pre-0017 read. Quiet static placeholder.
  if (loading || !e) {
    return (
      <section className="page-card goal">
        <div className="goal-head">
          <span className="goal-label">Bulk Journey</span>
        </div>
        <p className="goal-sub">
          {loading ? "Loading…" : "No bulk baseline yet — the owner sets it when the bulk starts."}
        </p>
      </section>
    );
  }

  const bulkDay = bulkStartDate ? daysSince(bulkStartDate) : null;
  const gained = e.gainedWeight;
  const gainedStale = isStale("weight", weightLatestDate ?? null);
  const atCeiling = bulkGoalStatus?.reached ?? false;
  const paceWord = state ? paceLabel(state.evaluation) : null;
  const tone = state ? paceTone(state.evaluation) : null;
  return (
    <div className="page-card goal">
      <button type="button" className="goal-navblock" onClick={onNav}>
        <div className="goal-head">
          <span className="goal-label">{atCeiling ? "Fat budget spent" : "Bulk Journey"}</span>
          <span className="goal-head-right">
            {!atCeiling && bulkDay != null && (
              <span className="goal-label goal-day">
                Day <b>{bulkDay}</b>
              </span>
            )}
            <span className="goal-chevron" aria-hidden>›</span>
          </span>
        </div>
        {/* Hero — the win (weight gained) vs the runway (body-fat headroom).
            The gained number stays neutral ink here; the up-good polarity read
            lives on the Weight card's delta, and the pace verdict on the pill. */}
        <div className="goal-hero">
          <div className="goal-hero-left">
            <span className="goal-pct">
              {gained >= 0 ? "+" : "−"}
              {Math.abs(gained).toFixed(1)}
            </span>
            <span className="goal-complete">kg gained</span>
          </div>
          <div className="goal-hero-right">
            <MetricValue size="md" unit="pp headroom">{e.headroomPp.toFixed(1)}</MetricValue>
            <div className="goal-sub">to {e.bfCeiling.toFixed(0)}% cap</div>
          </div>
        </div>
        <BulkBudgetTrack
          budgetUsedPct={e.budgetUsedPct}
          bodyFat14dAvg={e.bodyFat14dAvg}
          startBodyFat={e.startBodyFat}
          bfCeiling={e.bfCeiling}
        />
        <div className="goal-footer">
          {paceWord && (
            <Badge
              pill
              tone={tone ?? "neutral"}
              mark={tone ? (tone === "good" || tone === "gold" ? "✓" : "!") : undefined}
            >
              {paceWord}
            </Badge>
          )}
          <span className="goal-sub goal-lost">
            Budget <b>{Math.round(e.budgetUsedPct)}</b>% used
            {gainedStale && weightLatestDate && (
              <span className="goal-lost-stale"> as of {formatAgo(weightLatestDate)}</span>
            )}
          </span>
        </div>
      </button>
      {phase && goalStatus && (
        <PhasePlanSection
          phase={phase}
          goalStatus={goalStatus}
          bulkGoalStatus={bulkGoalStatus}
          cutMode={state?.diagnostics.cutMode ?? null}
        />
      )}
    </div>
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
        <span className="goal-label">Cut Journey</span>
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

// The bulk twin of CutBaselineCard: shown ONLY while the phase is a Lean Bulk
// (intake in surplus) and no bulk baseline exists. Pins the starting line AND
// the endpoint in one save — the body-fat ceiling at which the bulk ends and
// the next cut starts. Same one-time rules: the snapshot is persisted, never
// recomputed; to redo a bulk, edit nutrition_config.bulk_* directly.
function BulkBaselineCard({
  metrics,
  defaultCeiling,
  onSaved,
}: {
  metrics: BodyMetric[];
  /** Prefill for the ceiling — the cut target + a few pp when configured. */
  defaultCeiling: number;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [ceiling, setCeiling] = useState(String(defaultCeiling));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = date ? cutBaselineAt(metrics, date) : null;
  const ceilingNum = Number(ceiling);
  const ceilingOk = isFinite(ceilingNum) && ceilingNum >= 8 && ceilingNum <= 30;
  const canSave = !!date && preview?.bodyFatPct != null && ceilingOk;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveBulkBaseline(date, ceilingNum, metrics);
      onSaved();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setSaving(false);
    }
  }

  return (
    <div className="page-card goal goal-init">
      <div className="goal-head">
        <span className="goal-label">Bulk Journey</span>
      </div>
      <p className="goal-init-lede">
        Set when this bulk began and the body-fat ceiling that ends it. Weight gained and the
        fat budget are both measured from that fixed point.
      </p>
      <label className="goal-init-field">
        <span>Bulk start date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="goal-init-field">
        <span>Body-fat ceiling (%)</span>
        <input
          type="number"
          inputMode="decimal"
          min={8}
          max={30}
          step={0.5}
          value={ceiling}
          onChange={(e) => setCeiling(e.target.value)}
        />
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
      {!ceilingOk && ceiling !== "" && (
        <p className="goal-init-preview">Ceiling must be between 8% and 30%.</p>
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
// at the *right rate*". They can differ — down but slow reads green delta +
// orange "Below pace" — and that pairing is the point, not a contradiction.
// Gold is reserved for "Optimal" (on-target AND in the band's top slice, near
// the safe max) — a celebration read, not just an absence of caution.
// Full-width 14-day weight trend line. Line-only (no beads/labels) to keep the
// Health-tab minimalism, but stretched edge-to-edge as the card's dominant
// element. Smoothing stays honest — raw daily readings from `series`, same
// source the Health weight card uses; no new interpolation.
// preserveAspectRatio="none" stretches the 100×64 viewBox to fill the card
// width while non-scaling-stroke keeps the line a constant 2px.

// Trend line is a 3.5-day (84h) trailing average of the raw daily readings —
// the KPI is the loss RATE, so the line should read as "where's the trend
// headed", not jitter on every water-weight blip. Per-day detail lives in the
// trend sheet the chart opens on tap, not inline.
const TREND_WINDOW_HOURS = 84;

// Inline spark / corridor window, in calendar days. Deliberately the SAME span
// the hero rate (and the recommendation's observed rate) is fit on, so the
// dashed corridor never spans a different period than the number above it. This
// is why this card's corridor looks steeper/narrower than Health's weight card:
// Health draws its corridor over a 42-day trend, this one over 21 days of pace.
// Kept as a named constant so the "21-day pace" label and the cutoff geometry
// below can't drift apart.
const SPARK_WINDOW_DAYS = 21;

function WeightSparkline({
  points,
  tone,
  targetRange,
  direction = -1,
}: {
  points: { date: string; value: number }[];
  // The LINE's own tone: moving in the phase direction = green (down on a cut,
  // up on a bulk), against it red, flat otherwise. Deliberately independent of
  // pace — the pace verdict is the Journey pill's job, so the trend line NEVER
  // goes gold (coordination rule: gold stays rare). See WeightCard.
  tone: "good" | "bad" | "flat";
  targetRange?: { min: number; max: number } | null;
  /** Phase sign for the corridor wedge (phaseDirection): −1 cut, +1 bulk. */
  direction?: 1 | -1;
}) {
  const stroke =
    tone === "good"
      ? "var(--good)"
      : tone === "bad"
        ? "var(--bad)"
        : "var(--ink-4)";
  // Corridor is NEUTRAL ink, not green — it labels a target BAND (a range),
  // which is a "where's the goal" reference, not a verdict. Keeping it green
  // double-counted the healthy read the line already carries and flooded the
  // card (Journey stays the page's green hero — see the coordination rule). The
  // one green left on this card is the line's own stroke. Matches the hero
  // legend's dashed swatch (kept in sync in overview.css).
  const corridorColor = "var(--ink-4)";
  const gradId = `ov-spark-grad-${tone}`;
  const W = SPARK_W, H = SPARK_H, pad = SPARK_PAD;

  // Not enough data: hold the 80px height with a flat dashed placeholder so the
  // card never changes height between loading / empty / loaded (layout stability).
  if (points.length < 2) {
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

  // Geometry — the trend polyline, gradient area, and the target-pace corridor
  // wedge, all projected into the SVG's coordinate space. points arrives
  // pre-smoothed (trailingAvg over the caller's full history, already sliced to
  // this window); the corridor rays anchor at a Theil-Sen fit of the drawn
  // trend, not one edge point. See buildSparkGeometry.
  const { pts, area, corridor, latest } = buildSparkGeometry(points, targetRange, direction);

  // The latest dot is a plain "you are here" marker in the line's own tone. Pace
  // lives in the acceleration chip + the Journey pace pill; the dot no longer
  // carries a third, near-imperceptible, redundant pace tint.
  const dotCore = stroke;

  return (
    <div className="ov-weight-spark-wrap">
      <svg
        className="ov-weight-spark ov-weight-spark--draw"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {corridor && (
          <>
            <polygon
              points={`${corridor.x0.toFixed(1)},${corridor.y0.toFixed(1)} ${corridor.xEnd.toFixed(1)},${corridor.yMin.toFixed(1)} ${corridor.xEnd.toFixed(1)},${corridor.yMax.toFixed(1)}`}
              fill={corridorColor}
              opacity="0.07"
              stroke="none"
            />
            <line
              x1={corridor.x0.toFixed(1)} y1={corridor.y0.toFixed(1)}
              x2={corridor.xEnd.toFixed(1)} y2={corridor.yMin.toFixed(1)}
              stroke={corridorColor} strokeWidth="1" opacity="0.4"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
            <line
              x1={corridor.x0.toFixed(1)} y1={corridor.y0.toFixed(1)}
              x2={corridor.xEnd.toFixed(1)} y2={corridor.yMax.toFixed(1)}
              stroke={corridorColor} strokeWidth="1" opacity="0.4"
              strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
            />
          </>
        )}
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
      {/* Rendered outside the SVG, not as a <circle>: the chart's viewBox is
          stretched non-uniformly (W=100 vs a ~350px card, H fixed 1:1 at 80px),
          so an in-SVG circle inherits that stretch and renders as a flat
          ellipse. A fixed-size HTML dot stays round regardless. Left is a %
          (matches the SVG's fluid width); top is px + the SVG's own
          margin-top offset, since H maps 1:1 to its fixed 80px CSS height. */}
      <div
        className="ov-weight-spark-latest-dot"
        style={{
          left: `${(latest.x / W) * 100}%`,
          top: `calc(var(--vr-block) + ${latest.y.toFixed(1)}px)`,
          // The latest reading, enlarged. Core is the line tone normally, but an
          // off-band pace tints it (dotCore) so a non-record reading carries the
          // pill's caution instead of a bare green dot.
          ["--dot-core" as string]: dotCore,
        }}
      />
    </div>
  );
}

function WeightCard({
  weightLatest,
  metrics,
  state,
  onNav,
  onNavEmpty,
  loading = false,
}: {
  weightLatest: number | null;
  metrics: BodyMetric[];
  state: NutritionStateFull | null;
  // Loaded card → Nutrition (the pace read); empty card → Health (its CTA is
  // "sync from Apple Health"). Two targets, one per destination-that-fits.
  onNav: () => void;
  onNavEmpty: () => void;
  loading?: boolean;
}) {
  // observedRate is a real 0-fallback when no trend could be fit (<5 readings in
  // the window). Present that as "—" rather than a fabricated "±0.00 kg/week".
  const rate =
    state != null && state.diagnostics.weightDataPoints >= MIN_TREND_POINTS
      ? state.evaluation.observedRate
      : null;
  // Rate-TREND arrow beside the hero — the glyph is the second-order read: is
  // the loss speeding up (▲) or slowing toward a plateau (▼)?, NOT the weight's
  // own direction. In-band acceleration reads good (green); a slowdown warns
  // (amber, early-plateau catch); only a real out-of-band drift goes red
  // (rateTone=bad). Never gold: how good the value IS lives on the status pill
  // below, not on this arrow. Mirrors Nutrition's pace arrow.
  const accelDirection = state?.evaluation.accelDirection ?? null;
  const rateBandTone = state ? rateTone(state.evaluation) : null;
  const accelTone = accelArrowTone(rateBandTone, accelDirection);
  // Only a conclusive pace verdict carries the cut baseline day count; an
  // inconclusive read ("Forming"/"Calibrating") is just the word, no suffix.
  // The whole card navigates to Nutrition (the pace verdict is Nutrition's
  // territory); the sparkline is an inline read only, not a second tap target —
  // full weight history lives on Health's weight card. One card, one action.

  // Cold load — same div shell (tag matches the loaded card so the node isn't
  // replaced), placeholder stat + flat sparkline + Rate/Status row. Resolves in
  // place when data lands.
  if (loading) {
    return (
      <div className="page-card ov-weight loading-card">
        <div className="ov-weight-head">
          <span className="ov-weight-label">Weight</span>
          <span className="ov-weight-chevron" aria-hidden>›</span>
        </div>
        <div className="ov-weight-hero">
          <div className="ov-weight-stat">
            <MetricValue size="xl" unit="kg/wk">0.00</MetricValue>
          </div>
        </div>
        <WeightSparkline points={[]} tone="flat" />
        {/* Footer placeholder — mirrors the loaded card's "Now" row so the
            skeleton holds the same height (LAYOUT-STABILITY). */}
        <div className="ov-weight-footer">
          <span className="ov-weight-now">Now <b>00.0</b> kg</span>
        </div>
      </div>
    );
  }

  // 7-day average vs the prior 7 days — same signal the Health weight card
  // shows; down = good on a cut. Threshold-suppressed when within noise.
  const weightPts = series(metrics, "weight_kg");
  // Latest weigh-in date → the top-right FreshnessTag (quiet "N days ago",
  // warn-toned once past the weight cadence; hidden if you weigh regularly).
  const weightDate = weightPts.at(-1)?.date ?? null;
  const thisWeek = rollingAvg(weightPts, 7, 0);
  const prevWeek = rollingAvg(weightPts, 7, 7);
  const weightDelta = thisWeek != null && prevWeek != null ? thisWeek - prevWeek : null;

  // Last 21 daily readings — the trend shape under the number, over the SAME
  // 21-day window the recommendation's observed rate (and this card's hero rate)
  // is fit on, so the corridor and the number never span different periods. The
  // line itself stays a 3.5-day trailing average (TREND_WINDOW_HOURS), so a
  // longer window shows more trend, not more jitter. Line tone is driven by the
  // SAME weightDelta sign as MetricDelta below (down = good on a cut): direction
  // from the number's sign, colour from the tone — kept independent, matching
  // the delta-arrow rule.
  // trailingAvg runs over the FULL history, not the 21d slice — otherwise the
  // window's first few points would average over their own truncated stub
  // (day 0 averaging with nothing before it) instead of true prior history,
  // understating the smoothing right where the corridor anchors its start.
  // Window is 21 calendar DAYS (same cutoff convention as theilSenSlope:
  // last date − 20), not the last 21 readings — a missed weigh-in day must
  // not silently stretch the chart onto a longer window than the rate it
  // sits beside was fit on.
  const sparkCutoff = weightDate
    ? localDateStr(new Date(new Date(weightDate + "T12:00:00").getTime() - (SPARK_WINDOW_DAYS - 1) * 86400000))
    : "";
  const sparkPoints = trailingAvg(weightPts, TREND_WINDOW_HOURS).filter((p) => p.date >= sparkCutoff);
  // Weight polarity follows the phase from the SAME persisted evaluation row
  // every other read on this card uses (null state → the cut default): on a
  // bulk, up = green — the exact mirror of the cut's rule.
  const phaseKind = state?.evaluation.phaseKind ?? "cut";
  const weightDir = weightMetricDirection(phaseKind);
  const sparkTone = weightLineTone(weightDelta, weightDir);

  // Corridor legend (hero-right): the target loss-rate band, shown beside the
  // rate so the dashed swatch keys the chart's dashed corridor. Only when a real
  // active band exists (min !== max — an inactive target collapses the range).
  const targetRange = state?.evaluation.targetRange ?? null;
  const hasTargetBand = !!targetRange && targetRange.min !== targetRange.max;

  if (weightLatest == null) {
    return (
      <div
        role="button"
        tabIndex={0}
        className="page-card ov-weight ov-weight--empty"
        onClick={onNavEmpty}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavEmpty();
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

  // Rate leads: on a cut the KPI you act on is the loss RATE (kg/wk), not the
  // day's scale weight (water/glycogen noise). So the hero is the rate and the
  // current weight is demoted to the "Now" context number in the footer. Until
  // the trend settles (rate == null → Forming/Calibrating) the hero falls back
  // to the weight level so the card always leads with a real number.
  //
  // With data present the whole card opens Nutrition's recommendation: what it
  // reports is the loss rate against the calorie-target corridor — a pace
  // verdict, which is Nutrition's territory ("am I on track / what do I
  // change"), not the raw metric. The full weight history still lives on
  // Health's weight card, but this card is about pace, so it lands where you act
  // on it. (The empty state is the exception — its CTA is "sync from Apple
  // Health", so it routes to Health via onNavEmpty. And the earlier in-card
  // split — body → Health, a nested pace pill → Nutrition — was dropped when the
  // verdict pill was quieted away, so there is no nested <button> to preserve.)
  // It's a div with role=button rather than a native <button> only for parity
  // with the loading/empty branches above.

  return (
    <div
      role="button"
      tabIndex={0}
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
        <span className="ov-weight-head-right">
          <FreshnessTag date={weightDate} kind="weight" updatedAt={latestUpdatedAt(metrics, "weight_kg")} />
          <span className="ov-weight-chevron" aria-hidden>›</span>
        </span>
      </div>
      {/* Hero: the loss RATE (kg/wk) — neutral-ink magnitude carries the
          prominence by SIZE. The arrow after it is the rate TREND, not the
          weight's sign: accelerating (▲) / slowing (▼) from accelDirection, so
          a plain loss no longer reads as "good". Its colour is band-aware
          (accelArrowTone): in-band acceleration green, a slowdown or drift
          toward an edge amber, far out red — never gold (how good the pace IS
          lives on the status pill and the sparkline). Mirrors Nutrition's pace
          arrow. Before the trend settles the hero falls back to the weight
          level + its weekly delta — same `xl` size so the card never changes
          scale between states. */}
      {/* Hero row — the loss RATE (left) paired with the corridor legend (right).
          Keeping the target band up here ties the dashed swatch to the geometry
          it labels (the chart's dashed corridor), rather than restating it in
          the footer. */}
      <div className="ov-weight-hero">
        {rate != null ? (
          <div className="ov-weight-stat">
            {/* Direction word — the hero rate is always shown as an unsigned
                magnitude (the size IS the emphasis), so this names which way
                it's moving in words rather than making the reader infer it
                from a sign that isn't there. */}
            <span className="ov-weight-direction">{rate > 0 ? "Gaining" : "Losing"}</span>
            <MetricValue size="xl" unit="kg/wk">
              <HeadlineCountUp
                value={Math.abs(rate)}
                decimals={2}
                format={(n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </MetricValue>
            {/* Acceleration chip — a worded pill replacing the old bare arrow
                glyph, same accelArrowTone (band-aware: in-band = good, a
                slowdown or drift toward an edge = warn, far out = bad). */}
            {accelDirection && (
              // "faster/slowing" is already phase-directed (progress space, see
              // weightAcceleration); only the wording names the phase's verb.
              <span className={`ov-weight-accel-chip is-${accelTone}`}>
                {phaseKind === "bulk"
                  ? accelDirection === "faster" ? "▲ gaining faster" : "▼ gain slowing"
                  : accelDirection === "faster" ? "▲ speeding up" : "▼ slowing"}
              </span>
            )}
          </div>
        ) : (
          <div className="ov-weight-stat">
            <MetricValue size="xl" unit="kg">
              <HeadlineCountUp
                value={weightLatest}
                decimals={1}
                format={(n) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              />
            </MetricValue>
            <MetricDelta value={weightDelta} direction={weightDir} decimals={1} unit="kg" />
          </div>
        )}
        {/* Window qualifier — names the period the hero rate is fit on (and the
            span the dashed corridor is drawn over: same 21 days). "pace" not
            "trend" so it reads as a distinct view from Health's "42-day trend"
            weight card, whose corridor spans a different window. Only shown once
            a real fit exists (rate != null); Forming/Calibrating has no pace. */}
        {rate != null && (
          <span className="ov-weight-window">{SPARK_WINDOW_DAYS}-day pace</span>
        )}
      </div>

      <WeightSparkline
        points={sparkPoints}
        // Line colour follows the week-over-week direction in the phase's
        // polarity (down = good on a cut, up = good on a bulk) and STAYS there
        // regardless of pace — the trend line never floods the card with gold.
        // Pace is carried by the acceleration chip and the Journey pace pill.
        tone={sparkTone}
        targetRange={state?.evaluation.targetRange ?? null}
        direction={phaseDirection(phaseKind)}
      />
      {/* Footer — current reading (left) + the target corridor legend
          (right), moved down from the hero row so the hero's right side is
          free for the acceleration chip. */}
      <div className="ov-weight-footer">
        <span className="ov-weight-now">
          Now <b>{fmt1kg(weightLatest)}</b> kg
        </span>
        {hasTargetBand && (
          <span className="ov-weight-legend">
            <span className="ov-weight-legend-swatch" aria-hidden />
            <span className="ov-weight-legend-text">
              Target <b>{targetRange!.min.toFixed(2)}–{targetRange!.max.toFixed(2)}</b> kg/wk
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Overview Page ─────────────────────────────────────────────────────── */

// Module-scope, not component state: survives the full remount Shell does on
// a "fresh" tab entry (first visit, deep-link, or a return after sitting idle
// past REPLAY_IDLE_MS — see the tab-navigation-scroll skill). Without this,
// every such remount resets `data` to null, so the whole page — despite every
// card already having a proper in-place skeleton — flashes back through that
// skeleton just to re-show numbers that (for a stale-but-recent visit) mostly
// haven't changed. Seeding state from the last render instead means a fresh
// remount shows the last-known snapshot immediately and refreshes it silently
// underneath, exactly like a same-mount activity bump already does; only a
// true first-ever load (nothing cached yet) still shows the skeleton.
//
// Keyed by user id: this app supports signed-in shared viewers (see
// shared-read-only-access), so a sign-out/sign-in swap on the SAME tab must
// never seed the next account's first render from the previous account's
// cached numbers — a stale module var would leak across that swap since it
// outlives the component unmount. A mismatched id is treated as empty.
let lastOverviewData: OverviewData | null = null;
let lastOverviewUserId: string | null = null;

export function OverviewPage() {
  const activity = useTabActivity();
  const nav = useNav();
  const user = useSessionUser();
  const readOnly = useIsReadOnly();

  const cached = user && user.id === lastOverviewUserId ? lastOverviewData : null;
  const [data, setData] = useState<OverviewData | null>(cached);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchOverview()
      .then((d) => {
        lastOverviewData = d;
        lastOverviewUserId = user?.id ?? null;
        setData(d);
      })
      .catch((e) => setError(String(e?.message ?? e)));

  useEffect(() => {
    void load();
  }, [activity]);

  // Cards render in-place: each is always mounted and shows its own skeleton
  // while `loading`, then resolves the same DOM to real values when data lands
  // (no separate skeleton subtree to unmount, so the entrance never replays).
  const loading = !data;

  // Keep the System banner mounted through its collapse-out when a directive is
  // dismissed or clears (rec → null). Hold the last rec so it still has content
  // to render while .is-closing plays; 200 mirrors --dur-exit (the collapse).
  const rec = data?.nutritionState?.recommendation ?? null;
  const systemExit = useExitTransition(rec != null, 200);
  const lastRec = useRef<Recommendation | null>(null);
  if (rec) lastRec.current = rec;
  const shownRec = rec ?? lastRec.current;

  const header = (
    <div className="shell-header">
      <PageTopBar eyebrow={fmtTopbarDate()} title={greeting(user, displayNameFor(user?.email))} onCopy={copyAllData} />
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

  // Stable keys on every direct child so React reconciles each card across the
  // loading → loaded transition (and across SystemCard appearing) by identity,
  // not by index. Without keys, inserting the banner would shift positions and
  // remount the cards below it — replaying their entrance, the very flash we're
  // removing. Each card renders its own skeleton in place while `loading`.
  return (
    <div className="page">
      {header}
      {/* System — a conditional actionable banner (usually absent), so it's not
          skeletonized; it appears only when there's something to act on. Stays
          mounted through its exit (systemExit) so it collapses out, not cuts. */}
      {systemExit.mounted && shownRec && (
        <SystemCard
          key="system"
          rec={shownRec}
          closing={systemExit.closing}
          onNav={(tab) => nav(tab)}
          onDismiss={
            readOnly
              ? undefined
              : () => {
                  // Optimistic: drop the banner now, persist + auto-clear in the
                  // background, then reload so the next directive (if any) lands.
                  setData((d) => (d ? { ...d, nutritionState: { ...d.nutritionState!, recommendation: null } } : d));
                  void dismissRecoveryDirective().then(load).catch(() => load());
                }
          }
        />
      )}

      {/* Active Target — leads: the actionable "what do I do today" number. */}
      <ActiveTargetCard
        key="active-target"
        loading={loading}
        view={data?.activeTarget ?? null}
        targetTdee={data?.targetTdee ?? null}
        currentTdee={data?.currentTdee ?? null}
        syncAt={data ? latestUpdatedAt(data.metrics, "active_energy_kcal") : null}
        metrics={data?.metrics ?? []}
        onNav={() => nav("health", { scrollTo: "health-energy-card", expand: true })}
      />

      {/* Journey slot — one card, phase-picked. A bulk phase swaps in the Bulk
          Journey (or its one-time baseline initializer); everything else keeps
          the cut pair, whose skeleton also covers loading (phase unknown until
          data lands). Same key so states resolve in place, not remount. */}
      {data && data.nutritionState?.evaluation.phaseKind === "bulk" ? (
        !readOnly && data.bulkStartDate == null ? (
          <BulkBaselineCard
            key="cut"
            metrics={data.metrics}
            defaultCeiling={Math.min(30, Math.max(8, (data.targetBodyFat ?? 18) + 3))}
            onSaved={() => void load()}
          />
        ) : (
          <BulkJourneyCard
            key="cut"
            bulkGoal={data.bulkGoal}
            bulkStartDate={data.bulkStartDate}
            weightLatestDate={series(data.metrics, "weight_kg").at(-1)?.date ?? null}
            state={data.nutritionState}
            phase={data.phase}
            goalStatus={data.goalStatus}
            bulkGoalStatus={data.bulkGoalStatus}
            onNav={() => nav("nutrition", { scrollTo: "nutrition-insight-card" })}
          />
        )
      ) : data && !readOnly && data.targetBodyFat != null && data.cutStartDate == null ? (
        <CutBaselineCard key="cut" metrics={data.metrics} onSaved={() => void load()} />
      ) : (
        <CutProgressCard
          key="cut"
          loading={loading}
          goal={data?.goal}
          cutStartDate={data?.cutStartDate ?? null}
          cutStartWeight={data?.cutStartWeight ?? null}
          weightLatestDate={data ? (series(data.metrics, "weight_kg").at(-1)?.date ?? null) : null}
          state={data?.nutritionState ?? null}
          phase={data?.phase ?? null}
          goalStatus={data?.goalStatus ?? null}
          bulkGoalStatus={data?.bulkGoalStatus ?? null}
          onNav={() => nav("nutrition", { scrollTo: "nutrition-insight-card" })}
        />
      )}

      <WeightCard
        key="weight"
        loading={loading}
        weightLatest={data?.weightLatest ?? null}
        metrics={data?.metrics ?? []}
        state={data?.nutritionState ?? null}
        onNav={() => nav("nutrition", { scrollTo: "nutrition-insight-card" })}
        onNavEmpty={() => nav("health", { scrollTo: "health-weight-card" })}
      />

      <StrengthHealthCard
        key="strength"
        variant="snapshot"
        loading={loading}
        strength={data?.strength}
        onNav={() => nav("training", { scrollTo: "training-strength-health-card", expand: true })}
      />
    </div>
  );
}
