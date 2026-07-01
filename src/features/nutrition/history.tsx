import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "@shared/components/ErrorState";
import { MetricValue } from "@shared/components/Metric";
import { getEntries, targetsFromConfig, type NutritionConfig, type NutritionEntry } from "./api";
import {
  getCalorieResult,
  getProteinResult,
  monthlyStats,
  toDateStr,
  weeklyStats,
  type CalorieState,
  type DayInput,
} from "./logic";

const WEEKDAY_NARROW = ["S", "M", "T", "W", "T", "F", "S"];

// Fixed display order — always all 5 states, on-plan first (matches design spec).
const DIST_STATES: { key: CalorieState; label: string; color: string }[] = [
  { key: "on-plan", label: "On plan", color: "var(--blue)" },
  { key: "under", label: "Under", color: "var(--ink-4)" },
  { key: "over", label: "Over", color: "var(--ink-4)" },
  { key: "extreme", label: "Extreme", color: "var(--gold)" },
  { key: "surplus", label: "Surplus", color: "var(--bad)" },
];

// Earliest loggable day — mirrors today.tsx.
const MIN_DATE = "2026-02-09";

function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function fmtShortDay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function haptic(kind: "tap" | "select" = "tap") {
  if (!navigator.vibrate) return;
  navigator.vibrate(kind === "select" ? 12 : 8);
}

function toInput(e: NutritionEntry): DayInput {
  return {
    date: e.entry_date,
    calories: e.calories,
    protein: e.protein,
    tdee: e.tdee,
    deficitTarget: e.deficit_target,
    proteinTarget: e.protein_target,
  };
}

export function HistoryView({
  config,
  date,
  onDateChange,
  entryVersion,
  onOpenCalendar,
}: {
  config: NutritionConfig;
  date: string;
  onDateChange: (date: string) => void;
  entryVersion: number;
  onOpenCalendar: () => void;
}) {
  const [entries, setEntries] = useState<NutritionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Direction for the week-range odometer roll + bar collapse/expand.
  const [weekNavDir, setWeekNavDir] = useState<"forward" | "backward" | null>(null);
  // True for the brief window where the outgoing week's bars are collapsing,
  // before weekAnchor actually flips to the new week.
  const [collapsing, setCollapsing] = useState(false);
  const weekRef = useRef<HTMLElement>(null);
  // The week strip browses independently of the page's selected `date`, so the
  // ‹ › chevrons don't drag the Today card (and the whole page) along with them.
  const [weekAnchor, setWeekAnchor] = useState(date);
  // Re-centre the strip when the page's day changes elsewhere (tapping a bar,
  // the Today card's own day nav).
  useEffect(() => setWeekAnchor(date), [date]);

  const defaultTargets = useMemo(() => targetsFromConfig(config), [config]);

  const todayStrNow = toDateStr(new Date());
  const canGoBack = shiftDate(weekAnchor, -7) >= MIN_DATE;

  // Change week: jump ±7 days (same weekday), clamped to [MIN_DATE, today].
  // Only moves the strip's own anchor — the page's selected day is untouched.
  // The outgoing bars collapse briefly before weekAnchor flips, so the new
  // week's bars expand in rather than simply replacing the old ones.
  function navigateWeek(dir: "forward" | "backward") {
    const delta = dir === "forward" ? 7 : -7;
    let next = shiftDate(weekAnchor, delta);
    if (dir === "forward" && next > todayStrNow) next = todayStrNow;
    if (dir === "backward" && next < MIN_DATE) return;
    if (next === weekAnchor) return;
    haptic("select");
    setWeekNavDir(dir);
    setCollapsing(true);
    window.setTimeout(() => {
      setWeekAnchor(next);
      setCollapsing(false);
    }, 130);
  }

  // Clear the slide class once the animation finishes so it can replay.
  useEffect(() => {
    if (!weekNavDir) return;
    const t = setTimeout(() => setWeekNavDir(null), 360);
    return () => clearTimeout(t);
  }, [weekNavDir, weekAnchor]);

  // Horizontal swipe on the week strip changes the week. Stop the gesture from
  // bubbling to Shell's tab-swipe handler.
  useEffect(() => {
    const el = weekRef.current;
    if (!el) return;
    let startX = 0, startY = 0, tracking = false, cancelled = false;
    const THRESHOLD = 56;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = false;
      cancelled = false;
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1 || cancelled) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!tracking) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 8) tracking = true;
        else if (Math.abs(dy) > 8) { cancelled = true; return; }
        else return;
      }
      e.preventDefault();
      e.stopPropagation();
    }
    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      e.stopPropagation();
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      navigateWeek(dx < 0 ? "forward" : "backward");
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [weekAnchor, todayStrNow]);

  useEffect(() => {
    const today = new Date();
    const to = toDateStr(today);
    // Cover the last 30 days (for the month stats) AND the Mon–Sun week that
    // contains the selected day, so navigating to an older week still has data.
    const monthFrom = new Date(today);
    monthFrom.setDate(today.getDate() - 29);
    const sel = new Date(weekAnchor + "T12:00:00");
    const selMonday = new Date(sel);
    selMonday.setDate(sel.getDate() - ((sel.getDay() + 6) % 7));
    const from = selMonday < monthFrom ? selMonday : monthFrom;
    getEntries(toDateStr(from), to)
      .then(setEntries)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [entryVersion, weekAnchor]);

  const { week, month, trend7, todayStr, isCurrentWeek } = useMemo(() => {
    const todayStr = toDateStr(new Date());
    const inputs = (entries ?? []).map(toInput);

    // Build Mon–Sun for the week the strip is currently browsing (weekAnchor),
    // independent of the page's selected day.
    const anchor = new Date(weekAnchor + "T12:00:00");
    const dow = anchor.getDay(); // 0=Sun … 6=Sat
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() - ((dow + 6) % 7)); // shift to Monday

    const trend7: DayInput[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = toDateStr(d);
      const found = inputs.find((x) => x.date === dateStr);
      trend7.push(
        found ?? {
          date: dateStr,
          calories: null,
          protein: null,
          tdee: null,
          deficitTarget: null,
          proteinTarget: null,
        },
      );
    }

    const logged7 = trend7.filter((d) => d.calories != null);
    const isCurrentWeek = trend7[0].date <= todayStr && todayStr <= trend7[6].date;

    // Month stats stay a strict last-30-days, independent of the viewed week.
    const monthFrom = new Date();
    monthFrom.setDate(monthFrom.getDate() - 29);
    const monthFromStr = toDateStr(monthFrom);
    const monthInputs = inputs.filter((d) => d.date >= monthFromStr && d.date <= todayStr);

    return { week: weeklyStats(logged7), month: monthlyStats(monthInputs), trend7, todayStr, isCurrentWeek };
  }, [entries, weekAnchor]);

  if (error) {
    return <ErrorState message={error} />;
  }

  if (!entries) {
    return (
      <>
        <section className="page-card loading-card">
          <p className="page-eyebrow">THIS WEEK</p>
          <div className="nutri-skel-week-bars">
            {["M","T","W","T","F","S","S"].map((d, i) => (
              <div key={i} className="nutri-skel-week-col">
                <div className="nutri-skel-bar-vert" style={{ height: `${30 + Math.abs((i - 3) * 8)}%` }} />
                <span className="nutri-skel-day">{d}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="page-card loading-card" style={{ height: 120 }} />
      </>
    );
  }

  return (
    <>
      {/* ── This Week ── */}
      <section ref={weekRef} className="page-card">
        <div className="section-head">
          <div className="hist-week-head">
            <p className="page-eyebrow" style={{ margin: 0 }}>THIS WEEK</p>
            <div className="hist-week-nav">
              <button
                type="button"
                className="hist-week-chevron"
                onClick={() => navigateWeek("backward")}
                disabled={!canGoBack}
                aria-label="Previous week"
              >
                ‹
              </button>
              <span
                className="hist-week-range"
                role="button"
                tabIndex={0}
                aria-label="Open date picker"
                onClick={() => { haptic("select"); onOpenCalendar(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); haptic("select"); onOpenCalendar(); }
                }}
              >
                <span
                  key={trend7[0].date}
                  className={`hist-week-range-roll${
                    weekNavDir === "forward" ? " roll-forward"
                    : weekNavDir === "backward" ? " roll-backward" : ""
                  }`}
                >
                  {`${fmtShortDay(trend7[0].date)} – ${fmtShortDay(trend7[6].date)}`}
                </span>
              </span>
              <button
                type="button"
                className="hist-week-chevron"
                onClick={() => navigateWeek("forward")}
                disabled={isCurrentWeek}
                aria-label="Next week"
              >
                ›
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {week.consistency && (
              <span className={`hist-badge badge-${week.consistency.toLowerCase()}`}>
                {week.consistency}
              </span>
            )}
          </div>
        </div>

        {/* KPI row — sits above the chart, unit-style copy */}
        <div className="nutri-kpi-row">
          <div className="nutri-kpi">
            <MetricValue size="md" unit={week.avgCalories > 0 ? "kcal avg" : undefined}>
              {week.avgCalories > 0 ? week.avgCalories.toLocaleString() : "—"}
            </MetricValue>
          </div>
          <div className="nutri-kpi">
            <MetricValue size="md" unit={week.avgProtein > 0 ? "g avg" : undefined}>
              {week.avgProtein > 0 ? week.avgProtein : "—"}
            </MetricValue>
          </div>
        </div>

        {/* Dual-bar 7-day trend */}
        <div className="nutri-trend">
          {trend7.map((d, i) => {
            const dayDate = new Date(d.date + "T12:00:00");
            const dayLabel = WEEKDAY_NARROW[dayDate.getDay()];
            const isToday = d.date === todayStr;
            const isFuture = d.date > todayStr;
            const isSelected = d.date === date;
            const hasCal = d.calories != null;
            const hasProtein = d.protein != null;

            const calTarget = d.tdee != null && d.deficitTarget != null
              ? Math.max(1, d.tdee - d.deficitTarget)
              : defaultTargets.calorieTarget;
            const protTarget = d.proteinTarget ?? defaultTargets.proteinTarget;

            const calResult = hasCal
              ? getCalorieResult(d.calories!, d.tdee ?? undefined, d.deficitTarget ?? undefined)
              : null;
            const protResult = hasProtein
              ? getProteinResult(d.protein!, d.proteinTarget ?? undefined)
              : null;

            const kcalPct = hasCal
              ? Math.max(7, Math.round(Math.min(100, (d.calories! / Math.max(1, calTarget)) * 100)))
              : 0;
            const protPct = hasProtein
              ? Math.max(7, Math.round(Math.min(100, (d.protein! / Math.max(1, protTarget)) * 100)))
              : 0;

            const isSurplus = calResult?.isSurplus ?? false;
            const doubleHit = calResult?.state === "on-plan" && protResult?.celebrated;

            return (
              <button
                key={d.date}
                className={[
                  "nutri-trend-col",
                  isSelected ? "is-selected" : "",
                  isToday ? "is-today-col" : "",
                  isFuture ? "is-future" : "",
                  !hasCal ? "is-missing" : "",
                  doubleHit ? "is-double-hit" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                disabled={isFuture}
                aria-label={
                  isFuture
                    ? `${d.date}: upcoming`
                    : `${d.date}${hasCal ? `: ${d.calories?.toLocaleString()} kcal, ${d.protein}g` : ": no entry"}`
                }
                onClick={() => {
                  if (isFuture) return;
                  haptic("select");
                  onDateChange(d.date);
                }}
              >
                {/* Value labels */}
                <div className="ntb-values">
                  {hasCal && (
                    <>
                      <span className="ntb-val-kcal">{d.calories?.toLocaleString()}</span>
                      {hasProtein && <span className="ntb-val-prot">{d.protein}g</span>}
                    </>
                  )}
                </div>

                {/* Bars: real → missed (past) or future (grey placeholder) */}
                <div className="nutri-trend-bars">
                  {hasCal || hasProtein ? (
                    <div
                      className={`ntb-pair${collapsing ? " is-collapsing" : ""}`}
                      style={{ "--bar-index": i } as React.CSSProperties}
                    >
                      <div
                        className={`ntb-bar ntb-bar-kcal${isSurplus ? " surplus" : ""}`}
                        style={{ height: hasCal ? `${kcalPct}%` : "7px" }}
                      />
                      <div
                        className={`ntb-bar ntb-bar-prot${doubleHit ? " celebrated" : ""}`}
                        style={{ height: hasProtein ? `${protPct}%` : "7px" }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`ntb-pair ntb-pair--missing${collapsing ? " is-collapsing" : ""}`}
                      style={{ "--bar-index": i } as React.CSSProperties}
                    >
                      <div className="ntb-bar ntb-bar--missing" />
                      <div className="ntb-bar ntb-bar--missing" />
                    </div>
                  )}
                </div>

                <span className={`nutri-trend-day${isToday ? " is-today" : ""}`}>
                  {dayLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Colour legend — matches the dual-bar colours */}
        <div className="nutri-trend-legend">
          <span className="nutri-trend-legend-item">
            <span className="nutri-trend-legend-dot" style={{ background: "var(--good)" }} />
            Calories
          </span>
          <span className="nutri-trend-legend-item">
            <span className="nutri-trend-legend-dot" style={{ background: "var(--blue)" }} />
            Protein
          </span>
        </div>
      </section>

      {/* ── Last 30 Days ── */}
      <section className="page-card nutri-month-card">
        <p className="page-eyebrow" style={{ margin: 0 }}>Last 30 Days</p>

        <div className="nutri-month-kpis">
          <MetricValue size="sm" unit="% adherence">{month.adherencePct}</MetricValue>
          <MetricValue size="sm" unit="% double hit">{month.doubleHitPct}</MetricValue>
          <MetricValue size="sm" unit="day streak">{month.currentStreak}</MetricValue>
        </div>

        {/* Distribution — one proportionally-coloured bar + text legend below */}
        <div className="nutri-dist-track" aria-hidden="true">
          {DIST_STATES.map(({ key, color }) => {
            const pct = Math.round(((month.distribution[key] || 0) / (month.logged || 1)) * 100);
            return pct > 0 ? <span key={key} style={{ width: `${pct}%`, background: color }} /> : null;
          })}
        </div>
        <div className="nutri-dist-legend">
          {DIST_STATES.map(({ key, label, color }) => {
            const pct = Math.round(((month.distribution[key] || 0) / (month.logged || 1)) * 100);
            return (
              <span className="nutri-dist-item" key={key}>
                <span className="nutri-dist-dot" style={{ background: color }} />
                {label} {pct}%
              </span>
            );
          })}
        </div>
      </section>
    </>
  );
}
