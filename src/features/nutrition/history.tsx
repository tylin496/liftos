import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "@shared/components/ErrorState";
import { MetricValue } from "@shared/components/Metric";
import { haptic } from "@shared/lib/haptics";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import { getEntries, targetsFromConfig, type NutritionConfig, type NutritionEntry } from "./api";
import {
  getCalorieResult,
  getProteinResult,
  toDateStr,
  weeklyStats,
  type DayInput,
} from "./logic";

const WEEKDAY_NARROW = ["S", "M", "T", "W", "T", "F", "S"];


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
  // Stable outer wrapper — owns the swipe listeners so they survive the inner
  // card remounting on each week change.
  const weekRef = useRef<HTMLDivElement>(null);
  // The card itself follows the finger during a drag and slides through on
  // commit (mirrors the Today card's containerRef/cardRef split).
  const weekCardRef = useRef<HTMLElement>(null);
  // Set the instant a swipe commits, so onDragEnd hands the transform to the
  // slide-in animation instead of snapping the card back.
  const weekCommitted = useRef(false);
  // The week strip browses independently of the page's selected `date`, so the
  // ‹ › chevrons don't drag the Today card (and the whole page) along with them.
  const [weekAnchor, setWeekAnchor] = useState(date);
  // Re-centre the strip when the page's day changes elsewhere (tapping a bar,
  // the Today card's own day nav).
  useEffect(() => setWeekAnchor(date), [date]);

  // Direction of the last week nav, used to animate the date range label.
  // Clears itself after the animation so the next nav can replay it.
  const [weekNavDir, setWeekNavDir] = useState<"forward" | "backward" | null>(null);
  useEffect(() => {
    if (!weekNavDir) return;
    const t = window.setTimeout(() => setWeekNavDir(null), 360);
    return () => window.clearTimeout(t);
  }, [weekNavDir]);

  const defaultTargets = useMemo(() => targetsFromConfig(config), [config]);

  const todayStrNow = toDateStr(new Date());
  const canGoBack = shiftDate(weekAnchor, -7) >= MIN_DATE;

  // Change week: jump ±7 days (same weekday), clamped to [MIN_DATE, today].
  // Only moves the strip's own anchor — the page's selected day is untouched.
  // The card remounts (key) and slides the new week in, so weekAnchor flips
  // immediately; the direction drives the slide animation.
  function navigateWeek(dir: "forward" | "backward") {
    const delta = dir === "forward" ? 7 : -7;
    let next = shiftDate(weekAnchor, delta);
    if (dir === "forward" && next > todayStrNow) next = todayStrNow;
    if (dir === "backward" && next < MIN_DATE) return;
    if (next === weekAnchor) return;
    haptic("select");
    weekCommitted.current = true;
    setWeekNavDir(dir);
    setWeekAnchor(next);
  }

  // Horizontal swipe changes the week. The whole card follows the finger/cursor
  // and slides through on commit; the hook also stops the gesture bubbling to
  // Shell's tab-swipe handler.
  useHorizontalSwipe(
    weekRef,
    (dir) => navigateWeek(dir === 1 ? "forward" : "backward"),
    {
      pointer: true,
      // Whole card follows the finger/cursor 1:1; rubber-band when there's no
      // week to reveal that way (forward past this week, back past the earliest).
      onDrag: (dx) => {
        const el = weekCardRef.current;
        if (!el) return;
        const atEdge = (dx < 0 && isCurrentWeek) || (dx > 0 && !canGoBack);
        const offset = atEdge ? Math.sign(dx) * Math.min(72, Math.abs(dx) * 0.2) : dx;
        el.style.transition = "none";
        el.style.transform = `translateX(${offset}px)`;
      },
      onDragEnd: () => {
        const el = weekCardRef.current;
        if (!el) return;
        if (weekCommitted.current) {
          // Committed: the card remounts (key={week}) and plays the slide-in
          // animation — clear the drag transform instantly so it doesn't fight it.
          weekCommitted.current = false;
          el.style.transition = "none";
          el.style.transform = "";
        } else {
          el.style.transition = "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)";
          el.style.transform = "";
        }
      },
    },
  );

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

  const { week, trend7, todayStr, isCurrentWeek } = useMemo(() => {
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

    return { week: weeklyStats(logged7), trend7, todayStr, isCurrentWeek };
  }, [entries, weekAnchor]);

  if (error) {
    return <ErrorState message={error} />;
  }

  const loading = !entries;

  return (
    <>
      {/* ── This Week ── The outer div owns the swipe gesture (stable across
          week changes); the inner card remounts + slides the new week through
          on commit, exactly like the Today card slides between days. */}
      <div ref={weekRef}>
      <section
        ref={weekCardRef}
        key={trend7[0].date}
        className={`page-card hist-week-card${loading ? " loading-card" : ""}${weekNavDir === "forward" ? " week-nav-forward" : weekNavDir === "backward" ? " week-nav-backward" : ""}`}
      >
        {/* Eyebrow is now the week's date range (drag the card to change week);
            tapping it still opens the date picker. */}
        <div className="section-head hist-week-head">
          <p
            className="page-eyebrow hist-week-eyebrow"
            role="button"
            tabIndex={0}
            aria-label="Open date picker"
            onClick={() => { if (loading) return; haptic("select"); onOpenCalendar(); }}
            onKeyDown={(e) => {
              if (loading) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); haptic("select"); onOpenCalendar(); }
            }}
          >
            <span className="hist-week-range-inner">
              {`${fmtShortDay(trend7[0].date)} – ${fmtShortDay(trend7[6].date)}`}
            </span>
          </p>
          <span
            className={`hist-status${week.consistency ? ` hist-status-${week.consistency.toLowerCase()}` : " hist-status--empty"}`}
          >
            {week.consistency ?? "Stable"}
          </span>
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
                      className="ntb-pair"
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
                      className="ntb-pair ntb-pair--missing"
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
      </div>
    </>
  );
}
