import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEntry, saveEntry, deleteEntry, targetsFromConfig, type NutritionConfig } from "./api";
import {
  calendarToday,
  getCalorieResult,
  getProteinResult,
  calorieTone,
  proteinTone,
  calorieNote,
  proteinNote,
  toDateStr,
} from "./logic";
import { useToast } from "@shared/components/Toast";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useCelebration } from "@shared/components/Celebration";
import { HeadlineCountUp } from "@shared/components/AnimatedNumber";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { COUNT_UP_MS } from "@shared/hooks/useCountUp";
import { Badge } from "@shared/components/Badge";
import { MacroEditFields, type MacroField } from "@shared/components/MacroEditFields";
import { haptic } from "@shared/lib/haptics";
import { localDateStr } from "@shared/lib/date";
import { CLEAR_AFTER_MOVE, CLEAR_AFTER_SHEEN } from "@shared/lib/motion";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import { useIsReadOnly } from "@app/layout/SessionContext";
import "@shared/components/nutriGrid.css";

const MIN_DATE = "2026-02-09";
// One-shot flag: has the day-swipe affordance hint already played?
const DAY_SWIPE_HINT_KEY = "nutri-day-swipe-hint-seen";
const INITIAL_HISTORY_MONTHS = 6;
const HISTORY_CHUNK_MONTHS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Calendar ──────────────────────────────────────────────────────────────────
function buildCalendarWeeks(
  todayStr: string,
  historyMonths: number,
  selectedDate: string,
): { dateStr: string; dayOfMonth: number; isMonthStart: boolean; dayMonth: string }[][] {
  const today = new Date(todayStr + "T12:00:00");
  const historyAnchor = new Date(today.getFullYear(), today.getMonth() - historyMonths, 1);
  const anchorOffset = (historyAnchor.getDay() + 6) % 7;
  const startDate = new Date(historyAnchor);
  startDate.setDate(historyAnchor.getDate() - anchorOffset);

  const selectedAnchor = new Date(selectedDate + "T12:00:00");
  if (selectedAnchor < startDate) {
    const selOffset = (selectedAnchor.getDay() + 6) % 7;
    startDate.setTime(selectedAnchor.getTime());
    startDate.setDate(selectedAnchor.getDate() - selOffset);
  }

  const minDate = new Date(MIN_DATE + "T12:00:00");
  if (startDate < minDate) startDate.setTime(minDate.getTime());

  const todayOffset = (today.getDay() + 6) % 7;
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + (6 - todayOffset) + 28);

  const weeks: { dateStr: string; dayOfMonth: number; isMonthStart: boolean; dayMonth: string }[][] = [];
  let week: (typeof weeks)[0] = [];
  const cursor = new Date(startDate);
  let isFirst = true;

  while (cursor <= endDate) {
    const dateStr = toDateStr(cursor);
    const isMonthStart = isFirst || cursor.getDate() === 1;
    isFirst = false;
    week.push({ dateStr, dayOfMonth: cursor.getDate(), isMonthStart, dayMonth: dateStr.slice(0, 7) });
    cursor.setDate(cursor.getDate() + 1);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);
  return weeks;
}

function NutriCalendar({
  selected,
  todayStr,
  onSelect,
  onClose,
  closing,
}: {
  selected: string;
  todayStr: string;
  onSelect: (date: string) => void;
  onClose: () => void;
  closing?: boolean;
}) {
  const [historyMonths, setHistoryMonths] = useState(INITIAL_HISTORY_MONTHS);
  const [visibleMonth, setVisibleMonth] = useState(selected.slice(0, 7));
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isExtendingRef = useRef(false);

  // aria-modal promises the page behind the scrim is inert — this was missing
  // a focus trap/Escape entirely, unlike every other dialog in the app.
  useFocusTrap(panelRef, onClose);

  const weeks = useMemo(
    () => buildCalendarWeeks(todayStr, historyMonths, selected),
    [todayStr, historyMonths, selected],
  );

  const scrollToSelected = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const target =
      grid.querySelector<HTMLButtonElement>(".ncal-day.is-selected") ??
      grid.querySelector<HTMLButtonElement>(".ncal-day.is-today");
    if (!target) return;
    const gridRect = grid.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    grid.scrollTop += targetRect.top + targetRect.height / 2 - (gridRect.top + gridRect.height / 2);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(scrollToSelected));
  }, [scrollToSelected]);

  function handleScroll() {
    const grid = gridRef.current;
    if (!grid) return;
    const markers = [...grid.querySelectorAll<HTMLButtonElement>(".ncal-day[data-month]")];
    const refY = grid.getBoundingClientRect().top + grid.getBoundingClientRect().height * 0.45;
    let current = markers[0];
    for (const m of markers) {
      if (m.getBoundingClientRect().top <= refY) current = m;
      else break;
    }
    if (current?.dataset.month) setVisibleMonth(current.dataset.month);
    if (!isExtendingRef.current && grid.scrollTop <= 96) {
      const earliest = grid.querySelector<HTMLButtonElement>(".ncal-day[data-date]");
      if (!earliest?.dataset.date || earliest.dataset.date <= MIN_DATE) return;
      isExtendingRef.current = true;
      const prevHeight = grid.scrollHeight;
      setHistoryMonths((m) => m + HISTORY_CHUNK_MONTHS);
      requestAnimationFrame(() => {
        grid.scrollTop += grid.scrollHeight - prevHeight;
        isExtendingRef.current = false;
      });
    }
  }

  const monthLabel = (() => {
    const d = new Date(visibleMonth + "-01T12:00:00");
    return (
      <>
        <strong>{d.toLocaleDateString("en-US", { month: "long" })}</strong>{" "}
        {d.toLocaleDateString("en-US", { year: "numeric" })}
      </>
    );
  })();

  return createPortal(
    <>
      <div className={`ncal-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={panelRef}
        className={`ncal-panel${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Date picker"
      >
        <div className="ncal-header">
          <span className="ncal-month-label">{monthLabel}</span>
          <button
            className="ncal-today-btn"
            type="button"
            onClick={() => { onSelect(todayStr); onClose(); }}
          >
            Today
          </button>
          <button className="ncal-close-btn" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ncal-weekdays">
          {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="ncal-grid" ref={gridRef} onScroll={handleScroll}>
          <div className="ncal-grid-inner">
            {weeks.map((week, wi) => (
              <div className="ncal-week" key={wi}>
                {week.map(({ dateStr, dayOfMonth, isMonthStart, dayMonth }) => {
                  const isFuture = dateStr > todayStr;
                  const isTooEarly = dateStr < MIN_DATE;
                  const isSelected = dateStr === selected;
                  const isToday = dateStr === todayStr;
                  const isFutureMonth = dayMonth > todayStr.slice(0, 7);
                  const cls = [
                    "ncal-day",
                    isSelected ? "is-selected" : "",
                    isToday ? "is-today" : "",
                    isFutureMonth ? "is-future-month" : "",
                    dayMonth === visibleMonth ? "is-visible-month" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={dateStr}
                      className={cls}
                      type="button"
                      data-date={dateStr}
                      data-day-month={dayMonth}
                      {...(isMonthStart ? { "data-month": dayMonth } : {})}
                      disabled={isFuture || isTooEarly}
                      onClick={() => { onSelect(dateStr); onClose(); }}
                    >
                      {dayOfMonth}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/* Intake rail — fills from empty alongside the number's count-up instead of
   snapping to full. Same pattern as Overview's GoalBarFill: sit at 0 until the
   flat --enter-wait beat (shared by the HeadlineCountUp above it), then grow to
   width over COUNT_UP_MS on the ease-out-quad mirror so the fill rides the
   digits — the rail's ONLY directional motion. The protein shortfall (gap) is
   an annotation, not a shape in motion: growing it (either direction) read as
   accrual, and painting it as a full-track underlay flashed an all-orange
   false state, so it holds its final width at the goal edge and fades in on
   the standard entrance clock, like the "to go" note it mirrors. Leaf
   component: the per-frame width change stays scoped here, not the whole
   card. Editing intake later re-transitions to the new width for free. */
function IntakeRailFill({ pct, short }: { pct: number; short?: boolean }) {
  const { ref, delayMs } = useBottomUpDelay<HTMLDivElement>();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (delayMs == null) return;
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setShown(true));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  // Fill holds its final width and sweeps in via scaleX (origin left); the gap
  // never moves — opacity only. Width rides the same ramp so later edits
  // re-transition instead of snapping; both start on the shared entrance beat.
  const sweep = `transform ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1), width ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`;
  const fade = `opacity var(--dur-enter) var(--ease-enter), width ${COUNT_UP_MS}ms cubic-bezier(0.5, 1, 0.89, 1)`;
  return (
    <div ref={ref} className="nt-track" aria-hidden="true">
      <div
        className="nt-track-fill"
        style={{ width: `${pct}%`, transform: shown ? "scaleX(1)" : "scaleX(0)", transition: sweep }}
      />
      {short && (
        <div
          className="nt-track-gap"
          style={{ width: `${100 - pct}%`, opacity: shown ? 1 : 0, transition: fade }}
        />
      )}
    </div>
  );
}

export function labelFor(date: string): string {
  const today = calendarToday();
  if (date === today) {
    const weekday = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday} Today`;
  }
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}


// ── TodayView ─────────────────────────────────────────────────────────────────
export function TodayView({
  config,
  date,
  onDateChange,
  daySelectNav,
  onSaved,
  calendarOpen,
  onCalendarOpenChange,
}: {
  config: NutritionConfig;
  date: string;
  onDateChange: (date: string) => void;
  /** Bumped by the trend bar's weekday-column tap (page.tsx) — replays the same
   *  day-nav slide as the arrow/swipe path below, just without re-calling
   *  onDateChange (the parent already changed `date`). */
  daySelectNav: { seq: number; dir: "forward" | "backward" } | null;
  onSaved?: () => void;
  calendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const readOnly = useIsReadOnly();
  const [editField, setEditField] = useState<MacroField | null>(null);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  // Whether a *saved* entry exists for this date — distinct from the
  // calories/protein edit buffer above, which changes on every keystroke.
  // Basing "hasEntry" on the buffer would flip it true the moment someone
  // starts typing a brand-new entry, prematurely showing "Update entry" /
  // "Delete entry" before anything's actually been saved.
  const [entryExists, setEntryExists] = useState(false);
  // A past day's stamped targets (plan-of-record). Present only for settled days
  // that carry a snapshot; today and legacy null-snapshot rows judge against the
  // live config instead. Keeps a navigated-to past day's verdict from flipping
  // when the current phase/config differs from the day it was logged.
  const [entrySnapshot, setEntrySnapshot] = useState<{
    tdee: number;
    deficitTarget: number;
    proteinTarget: number;
    calorieTarget: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const celebration = useCelebration();
  const [navDir, setNavDir] = useState<"forward" | "backward" | null>(null);
  // Bumped by navigate() (arrow / swipe) and by daySelectNav below (trend-bar
  // weekday tap). It keys the card so those paths remount it to replay the
  // slide animation — but picking a calendar date still changes `date` WITHOUT
  // bumping this, so the card updates in place (numbers swap), no slide.
  const [navSeq, setNavSeq] = useState(0);
  const lastDaySelectSeq = useRef(daySelectNav?.seq ?? 0);
  useEffect(() => {
    if (!daySelectNav || daySelectNav.seq === lastDaySelectSeq.current) return;
    lastDaySelectSeq.current = daySelectNav.seq;
    setNavDir(daySelectNav.dir);
    setNavSeq((n) => n + 1);
  }, [daySelectNav]);

  const containerRef = useRef<HTMLDivElement>(null);
  // The card itself (inside containerRef) is what follows the drag, so the
  // calendar overlay — a sibling under containerRef — never moves with it.
  const cardRef = useRef<HTMLElement>(null);
  // Set the instant a swipe commits, so onDragEnd knows to hand the transform
  // over to the day-nav enter animation instead of snapping the old card back.
  const swipeCommitted = useRef(false);
  // First-ever visit plays a half-drag on the card to reveal it's swipeable.
  const [dragHint, setDragHint] = useState(false);
  const isNavigating = useRef(false);
  // Skeleton belongs to the very first load only. Later date switches keep the
  // previous day's numbers on screen and swap in place — no full-card shimmer.
  const firstLoad = useRef(true);

  const todayStr = calendarToday();
  const isToday = date === todayStr;

  // Load entry when date changes
  useEffect(() => {
    let active = true;
    setEditField(null);
    // Skeleton only on the first load. On later date switches, keep the current
    // numbers visible and swap them for the new day's when they arrive, so
    // changing days never flashes the whole card to a shimmer.
    const skeletonTimer = firstLoad.current
      ? setTimeout(() => { if (active) setLoading(true); }, 300)
      : undefined;
    getEntry(date)
      .then((entry) => {
        if (!active) return;
        clearTimeout(skeletonTimer);
        setCalories(entry?.calories != null ? String(entry.calories) : "");
        setProtein(entry?.protein != null ? String(entry.protein) : "");
        setEntryExists(entry?.calories != null || entry?.protein != null);
        setEntrySnapshot(
          entry &&
            entry.tdee != null &&
            entry.deficit_target != null &&
            entry.protein_target != null &&
            entry.calorie_target != null
            ? {
                tdee: entry.tdee,
                deficitTarget: entry.deficit_target,
                proteinTarget: entry.protein_target,
                calorieTarget: entry.calorie_target,
              }
            : null,
        );
        setLoading(false);
        firstLoad.current = false;
        isNavigating.current = false;
      })
      .catch((e) => {
        if (!active) return;
        clearTimeout(skeletonTimer);
        toast(String(e?.message ?? e), "error");
        setLoading(false);
        firstLoad.current = false;
      });
    return () => { active = false; clearTimeout(skeletonTimer); };
  }, [date]);

  // Clear the slide direction once the animation finishes, so the class
  // doesn't linger and replay when the tab is re-shown (display: none → block).
  useEffect(() => {
    if (!navDir) return;
    // Clears just after the --dur-move slide finishes (shared mirror constant).
    const t = setTimeout(() => setNavDir(null), CLEAR_AFTER_MOVE);
    return () => clearTimeout(t);
  }, [navDir, date]);


  // Keyboard arrow navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (editField !== null || calendarOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active?.matches("input, textarea, select") || (active as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = shiftDate(date, -1);
        if (prev >= MIN_DATE) { haptic("select"); navigate(prev); }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!isToday) { haptic("select"); navigate(shiftDate(date, 1)); }
      } else if (e.key === "Escape" && editField !== null) {
        e.preventDefault();
        setEditField(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [date, editField, calendarOpen, isToday, onDateChange]);

  // Swipe gesture for day navigation. Disabled while an editor or the calendar
  // is open. The hook claims the horizontal gesture so Shell's tab-swipe stays out.
  useHorizontalSwipe(containerRef, (dir) => {
    if (dir === 1 && !isToday) {
      swipeCommitted.current = true; haptic("select"); navigate(shiftDate(date, 1));
    } else if (dir === -1) {
      const prev = shiftDate(date, -1);
      if (prev >= MIN_DATE) { swipeCommitted.current = true; haptic("select"); navigate(prev); }
    }
  }, {
    enabled: editField === null && !calendarOpen,
    pointer: true,
    // Whole card follows the finger/cursor 1:1; rubber-band when there's no day
    // to reveal that way (forward past today, or back past the first loggable day).
    onDrag: (dx) => {
      const el = cardRef.current;
      if (!el) return;
      const atEdge = (dx < 0 && isToday) || (dx > 0 && shiftDate(date, -1) < MIN_DATE);
      const offset = atEdge ? Math.sign(dx) * Math.min(72, Math.abs(dx) * 0.2) : dx;
      el.style.transition = "none";
      el.style.transform = `translateX(${offset}px)`;
    },
    onDragEnd: () => {
      const el = cardRef.current;
      if (!el) return;
      if (swipeCommitted.current) {
        // Committed: the card remounts (key={date}) and plays the day-nav enter
        // animation — clear the drag transform instantly so it doesn't fight it.
        swipeCommitted.current = false;
        el.style.transition = "none";
        el.style.transform = "";
      } else {
        el.style.transition = "transform var(--dur-exit) var(--ease-snap)";
        el.style.transform = "";
      }
    },
  });

  // First visit ever: nudge the card half-open once to show it can be dragged.
  // Deliberately LATE — let the entrance finish and give the user ~1s to read
  // the day's numbers first, so the swipe hint lands as a follow-up affordance
  // rather than competing with the rise-in.
  useEffect(() => {
    if (loading) return;
    if (localStorage.getItem(DAY_SWIPE_HINT_KEY)) return;
    const HINT_DELAY_MS = 1000; // entrance (~500ms) + reading time
    const start = setTimeout(() => {
      // Spend the one-time flag only once the hint actually plays, so bailing
      // out of the tab during the delay doesn't burn it unseen.
      localStorage.setItem(DAY_SWIPE_HINT_KEY, "1");
      setDragHint(true);
      // Reset is deliberately NOT tied to effect cleanup: navigating days flips
      // `loading`, which would otherwise clear it mid-hint and leave is-drag-hint
      // stuck (suppressing the day-nav slide). This one-shot always fires.
      setTimeout(() => setDragHint(false), 1200);
    }, HINT_DELAY_MS);
    return () => clearTimeout(start);
  }, [loading]);

  const liveTargets = useMemo(() => targetsFromConfig(config), [config]);
  // Past settled days are judged against their own stamped snapshot (matching
  // monthlyStats / history / phase reports); today uses the live plan.
  const targets =
    date < localDateStr() && entrySnapshot
      ? { ...liveTargets, ...entrySnapshot }
      : liveTargets;
  const calNum = Number(calories) || 0;
  const protNum = Number(protein) || 0;
  const hasEntry = entryExists;
  const calResult = getCalorieResult(calNum, targets.tdee, targets.deficitTarget);
  const protResult = getProteinResult(protNum, targets.proteinTarget);
  const doubleHit = calResult.state === "on-plan" && protResult.celebrated;

  function navigate(to: string) {
    const dir = to > date ? "forward" : "backward";
    isNavigating.current = true;
    setNavDir(dir);
    setNavSeq((n) => n + 1); // remount to replay the slide (arrow/swipe only)
    onDateChange(to);
  }

  function openEdit(field: "calories" | "protein") {
    if (readOnly) return; // viewers can see the numbers but not edit them
    haptic("tap");
    setSaveError(null);
    setEditField(field);
  }

  async function doSave(calN: number, protN: number) {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveEntry(date, { calories: calN, protein: protN }, config);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), CLEAR_AFTER_SHEEN);
      haptic("success");
      setEditField(null);
      setEntryExists(true);
      // Resolve the edit buffer to the saved absolute numbers so a re-opened
      // edit starts from the real saved value, not a lingering expression string.
      setCalories(String(calN));
      setProtein(String(protN));
      onSaved?.();

      const calRes = getCalorieResult(calN, targets.tdee, targets.deficitTarget);
      const protRes = getProteinResult(protN, targets.proteinTarget);
      const variant = calRes.state === "on-plan" && protRes.celebrated ? "double-hit" : "logged";
      celebration.celebrate(variant);
    } catch (e) {
      haptic("error");
      const msg = String((e as Error)?.message ?? e);
      toast(msg, "error");
      // Persists in the still-open form (unlike the 5s toast) so a missed
      // toast can't leave the user believing the entry saved.
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (deleting) return;
    const prevCalories = calories;
    const prevProtein = protein;
    const UNDO_MS = 5000;
    let undone = false;
    setCalories("");
    setProtein("");
    setEntryExists(false);
    setEditField(null);
    haptic("warning");
    const commit = setTimeout(async () => {
      if (undone) return;
      setDeleting(true);
      try {
        await deleteEntry(date);
        onSaved?.();
      } catch (e) {
        setCalories(prevCalories);
        setProtein(prevProtein);
        setEntryExists(true);
        haptic("error");
        toast(String((e as Error)?.message ?? e), "error");
      } finally {
        setDeleting(false);
      }
    }, UNDO_MS);
    toast("Entry deleted", "info", UNDO_MS, {
      label: "Undo",
      onClick: () => {
        undone = true;
        clearTimeout(commit);
        setCalories(prevCalories);
        setProtein(prevProtein);
        setEntryExists(true);
      },
    });
  }

  // Same note/tone language as Overview's Hero card — same underlying daily
  // entry, so the same feedback (shared/features/nutrition/logic.ts).
  const calNote = calorieNote(hasEntry, calResult, targets.deficitTarget);
  const protNote = proteinNote(hasEntry, protNum, targets.proteinTarget);
  const calToneVal = calorieTone(hasEntry, calResult);
  const protToneVal = proteinTone(hasEntry, protResult);

  // Progress rails under each column (see .nt-track). Neutral fill = consumed
  // ÷ target; protein's shortfall to the floor is the only coloured segment,
  // so it stays in step with protResult.celebrated / the "Xg to go" note.
  const caloriePct = targets.calorieTarget > 0
    ? Math.max(0, Math.min(100, Math.round((calNum / targets.calorieTarget) * 100)))
    : 0;
  const proteinMetPct = protResult.progress; // already clamped 0–100
  const proteinShort = hasEntry && !protResult.celebrated;

  // Day status badge (Today card, top-right). A pill only earns its place when
  // it says something the per-row notes don't. "On plan"/"Surplus"/"Low"/
  // "Tracking" just restate calNote — so the only pill left is the reward the
  // notes can't carry: Double Hit.
  const showDoubleHit = hasEntry && doubleHit;

  const isEditing = editField !== null;

  // Keep overlays mounted through their exit animation.
  const calendarT = useExitTransition(calendarOpen);

  return (
    <div ref={containerRef}>
      {calendarT.mounted && (
        <NutriCalendar
          selected={date}
          todayStr={todayStr}
          onSelect={(d) => { haptic("select"); onDateChange(d); }}
          onClose={() => onCalendarOpenChange(false)}
          closing={calendarT.closing}
        />
      )}

      {celebration.node}

      {/* Daily card. The id is Overview's log-intake deep-link target — a
          deep-link remounts the tab, so the form re-lands on defaultLogDate. */}
      <section
        id="nutrition-today-card"
        key={navSeq}
        ref={cardRef}
        className={[
          "page-card daily-card",
          loading ? "loading-card" : "",
          isEditing ? "is-editing" : "",
          !hasEntry ? "is-empty" : "",
          doubleHit ? "double-hit" : "",
          justSaved ? "is-saved" : "",
          dragHint ? "is-drag-hint" : "",
          navDir === "forward" ? "day-nav-forward" : navDir === "backward" ? "day-nav-backward" : "",
        ].filter(Boolean).join(" ")}
      >
        {/* Canonical "saved" check — pops, ticks, then fades over the ~1.1s save
            window (same vocabulary as Training's set-log). pointer-events:none so
            the edit pencil underneath stays tappable. */}
        {justSaved && (
          <svg className="daily-card-check" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="daily-card-check-circle" cx="10" cy="10" r="10" fill="var(--accent)" />
            <polyline className="daily-card-check-tick" points="5.5,10.5 8.5,13.5 14.5,7" pathLength="1" />
          </svg>
        )}
        {/* "INTAKE" names the card's content (the viewed day's calories +
            protein); the page header carries which day it is. A badge sits to
            the right when there's one — "No entry" and "Double Hit" are mutually
            exclusive (a double hit needs a logged entry). */}
        <div className="daily-card-top">
          <p className="page-eyebrow">Intake</p>
          <div className="daily-card-top-actions">
            {!isEditing && showDoubleHit && <Badge tone="gold" pill>Double Hit</Badge>}
            {/* Cold start: the tab's core action needs a real affordance, not a
                passive "No entry" dead-end. Viewers keep the plain badge. */}
            {!isEditing && !hasEntry && (
              readOnly ? (
                <Badge tone="neutral">No entry</Badge>
              ) : (
                <button type="button" className="nutri-log-cta" onClick={() => openEdit("calories")}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Log intake
                </button>
              )
            )}
            {/* Has entry: a quiet pencil so tap-to-edit is discoverable (the
                columns are otherwise plain text with no editable signal). */}
            {!isEditing && hasEntry && !readOnly && (
              <button type="button" className="nutri-edit-cta" aria-label="Edit intake" onClick={() => openEdit("calories")}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isEditing ? (
          <MacroEditFields
            calories={calories}
            protein={protein}
            onCaloriesChange={setCalories}
            onProteinChange={setProtein}
            activeField={editField ?? "calories"}
            onActiveFieldChange={setEditField}
            onSave={doSave}
            onCancel={() => { haptic("tap"); setEditField(null); setSaveError(null); }}
            onDelete={hasEntry ? handleDelete : undefined}
            saving={saving}
            hasEntry={hasEntry}
            error={saveError}
          />
        ) : (
          /* ── Stat grid — same layout/copy as Overview's Hero card ── */
          <div className="nutri-grid">
            <button
              type="button"
              className="nutri-col"
              aria-label={readOnly ? undefined : "Edit calories"}
              onClick={readOnly ? undefined : () => openEdit("calories")}
              tabIndex={readOnly ? -1 : undefined}
              style={readOnly ? { cursor: "default" } : undefined}
            >
              <span className="nutri-label">Calories</span>
              <span className="nutri-metric">
                {hasEntry ? (
                  <span className="metric-val metric-val--lg">
                    <HeadlineCountUp value={calNum} format={(n) => n.toLocaleString()} />
                  </span>
                ) : (
                  <span className="metric-val metric-val--lg stat-number--empty">—</span>
                )}
                {targets.calorieTarget > 0 && (
                  <span className="nutri-target">/ {targets.calorieTarget.toLocaleString()}</span>
                )}
              </span>
              {hasEntry && !loading && targets.calorieTarget > 0 && (
                <IntakeRailFill pct={caloriePct} />
              )}
              <span className={`nutri-delta ${calToneVal ?? "neutral"}`}>{calNote || "\u00A0"}</span>
            </button>
            <button
              type="button"
              className="nutri-col"
              aria-label={readOnly ? undefined : "Edit protein"}
              onClick={readOnly ? undefined : () => openEdit("protein")}
              tabIndex={readOnly ? -1 : undefined}
              style={readOnly ? { cursor: "default" } : undefined}
            >
              <span className="nutri-label">Protein</span>
              <span className="nutri-metric">
                {hasEntry ? (
                  <span className="metric-val metric-val--lg">
                    <HeadlineCountUp value={protNum} format={(n) => String(n)} />
                  </span>
                ) : (
                  <span className="metric-val metric-val--lg stat-number--empty">—</span>
                )}
                {targets.proteinTarget > 0 && (
                  <span className="nutri-target">/ {targets.proteinTarget}g</span>
                )}
              </span>
              {hasEntry && !loading && targets.proteinTarget > 0 && (
                <IntakeRailFill pct={proteinMetPct} short={proteinShort} />
              )}
              <span className={`nutri-delta ${protToneVal ?? "neutral"}`}>{protNote || "\u00A0"}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
