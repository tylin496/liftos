import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEntry, saveEntry, deleteEntry, targetsFromConfig, type NutritionConfig } from "./api";
import {
  defaultLogDate,
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
import { useCelebration } from "@shared/components/Celebration";
import { MetricCaption } from "@shared/components/Metric";
import { Badge } from "@shared/components/Badge";
import { MacroEditFields, type MacroField } from "@shared/components/MacroEditFields";
import { haptic } from "@shared/lib/haptics";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import "@shared/components/nutriGrid.css";

const MIN_DATE = "2026-02-09";
// One-shot flag: has the day-swipe affordance hint already played?
const DAY_SWIPE_HINT_KEY = "nutri-day-swipe-hint-seen";
const INITIAL_HISTORY_MONTHS = 6;
const HISTORY_CHUNK_MONTHS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Count-up animation ────────────────────────────────────────────────────────
function animateCountUp(el: HTMLElement, target: number, signal: { cancelled: boolean }) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = Math.round(target).toLocaleString();
    return;
  }
  const DURATION = 500;
  const start = performance.now();
  function step(now: number) {
    if (signal.cancelled) return;
    const t = Math.min(1, (now - start) / DURATION);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = Math.round(target).toLocaleString();
  }
  requestAnimationFrame(step);
}

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
  const isExtendingRef = useRef(false);

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
      <div className={`ncal-panel${closing ? " is-closing" : ""}`} role="dialog" aria-modal aria-label="Date picker">
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

export function labelFor(date: string): string {
  const today = defaultLogDate();
  if (date === today) {
    const weekday = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    return `${weekday} · Today`;
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
  onSaved,
  calendarOpen,
  onCalendarOpenChange,
}: {
  config: NutritionConfig;
  date: string;
  onDateChange: (date: string) => void;
  onSaved?: () => void;
  calendarOpen: boolean;
  onCalendarOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const [editField, setEditField] = useState<MacroField | null>(null);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  // Whether a *saved* entry exists for this date — distinct from the
  // calories/protein edit buffer above, which changes on every keystroke.
  // Basing "hasEntry" on the buffer would flip it true the moment someone
  // starts typing a brand-new entry, prematurely showing "Update entry" /
  // "Delete entry" before anything's actually been saved.
  const [entryExists, setEntryExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const celebration = useCelebration();
  const [navDir, setNavDir] = useState<"forward" | "backward" | null>(null);

  const calNumRef = useRef<HTMLElement>(null);
  const protNumRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // The card itself (inside containerRef) is what follows the drag, so the
  // calendar overlay — a sibling under containerRef — never moves with it.
  const cardRef = useRef<HTMLElement>(null);
  // Set the instant a swipe commits, so onDragEnd knows to hand the transform
  // over to the day-nav enter animation instead of snapping the old card back.
  const swipeCommitted = useRef(false);
  // First-ever visit plays a half-drag on the card to reveal it's swipeable.
  const [dragHint, setDragHint] = useState(false);
  const pendingCountUp = useRef(false);
  const isNavigating = useRef(false);
  const countUpSignal = useRef<{ cancelled: boolean }>({ cancelled: false });
  // Skeleton belongs to the very first load only. Later date switches keep the
  // previous day's numbers on screen and swap in place — no full-card shimmer.
  const firstLoad = useRef(true);

  const todayStr = defaultLogDate();
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
        setLoading(false);
        // Count-up is a first-appearance reveal only. Every later day switch —
        // arrows, swipe, tapping a week bar, or the calendar — swaps the numbers
        // in place, so changing days never re-animates the whole card.
        if (firstLoad.current) pendingCountUp.current = true;
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
    const t = setTimeout(() => setNavDir(null), 360);
    return () => clearTimeout(t);
  }, [navDir, date]);

  // Count-up animation after load
  useEffect(() => {
    if (loading || !pendingCountUp.current) return;
    pendingCountUp.current = false;
    const calN = Number(calories);
    const protN = Number(protein);
    const sig = { cancelled: false };
    countUpSignal.current = sig;
    if (calNumRef.current && calN > 0) animateCountUp(calNumRef.current, calN, sig);
    if (protNumRef.current && protN > 0) animateCountUp(protNumRef.current, protN, sig);
  }, [loading]);

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
        el.style.transition = "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
      }
    },
  });

  // First visit ever: nudge the card half-open once to show it can be dragged.
  useEffect(() => {
    if (loading) return;
    if (localStorage.getItem(DAY_SWIPE_HINT_KEY)) return;
    localStorage.setItem(DAY_SWIPE_HINT_KEY, "1");
    setDragHint(true);
    const t = setTimeout(() => setDragHint(false), 1200);
    return () => clearTimeout(t);
  }, [loading]);

  const targets = useMemo(() => targetsFromConfig(config), [config]);
  const calNum = Number(calories) || 0;
  const protNum = Number(protein) || 0;
  const hasEntry = entryExists;
  const calResult = getCalorieResult(calNum, targets.tdee, targets.deficitTarget);
  const protResult = getProteinResult(protNum, targets.proteinTarget);
  const doubleHit = calResult.state === "on-plan" && protResult.celebrated;

  function navigate(to: string) {
    const dir = to > date ? "forward" : "backward";
    countUpSignal.current.cancelled = true;
    countUpSignal.current = { cancelled: false };
    isNavigating.current = true;
    setNavDir(dir);
    onDateChange(to);
  }

  function openEdit(field: "calories" | "protein") {
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
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 750);
      haptic("success");
      setEditField(null);
      setEntryExists(true);
      pendingCountUp.current = true;
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

      {/* Daily card */}
      <section
        key={date}
        ref={cardRef}
        className={[
          "page-card daily-card",
          loading ? "loading-card" : "",
          isEditing ? "is-editing" : "",
          !hasEntry ? "is-empty" : "",
          doubleHit ? "double-hit" : "",
          savedPulse ? "saved-pulse" : "",
          dragHint ? "is-drag-hint" : "",
          navDir === "forward" ? "day-nav-forward" : navDir === "backward" ? "day-nav-backward" : "",
        ].filter(Boolean).join(" ")}
      >
        {/* "INTAKE" names the card's content (the viewed day's calories +
            protein); the page header carries which day it is. A badge sits to
            the right when there's one — "No entry" and "Double Hit" are mutually
            exclusive (a double hit needs a logged entry). */}
        <div className="daily-card-top">
          <p className="page-eyebrow">Intake</p>
          {!isEditing && !hasEntry && <Badge tone="neutral">No entry</Badge>}
          {!isEditing && showDoubleHit && <Badge tone="gold">Double Hit</Badge>}
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
            onDelete={hasEntry ? () => { haptic("warning"); handleDelete(); } : undefined}
            saving={saving}
            hasEntry={hasEntry}
            error={saveError}
          />
        ) : (
          /* ── Stat grid — same layout/copy as Overview's Hero card ── */
          <div className="nutri-grid">
            <button type="button" className="nutri-col" aria-label="Edit calories" onClick={() => openEdit("calories")}>
              <span className="nutri-label">Calories</span>
              {hasEntry ? (
                <span ref={calNumRef} className="metric-val metric-val--lg">
                  {calNum.toLocaleString()}
                </span>
              ) : (
                <span className="metric-val metric-val--lg stat-number--empty">—</span>
              )}
              {targets.calorieTarget > 0 && <MetricCaption>of {targets.calorieTarget.toLocaleString()} kcal</MetricCaption>}
              <span className={`nutri-delta ${calToneVal ?? "neutral"}`}>{calNote || "\u00A0"}</span>
            </button>
            <button type="button" className="nutri-col" aria-label="Edit protein" onClick={() => openEdit("protein")}>
              <span className="nutri-label">Protein</span>
              {hasEntry ? (
                <span ref={protNumRef} className="metric-val metric-val--lg">
                  {protNum}
                </span>
              ) : (
                <span className="metric-val metric-val--lg stat-number--empty">—</span>
              )}
              {targets.proteinTarget > 0 && <MetricCaption>of {targets.proteinTarget}g</MetricCaption>}
              <span className={`nutri-delta ${protToneVal ?? "neutral"}`}>{protNote || "\u00A0"}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
