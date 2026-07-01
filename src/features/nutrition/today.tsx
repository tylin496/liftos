import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getEntry, saveEntry, deleteEntry, targetsFromConfig, type NutritionConfig } from "./api";
import { defaultLogDate, getCalorieResult, getProteinResult, toDateStr } from "./logic";
import { useToast } from "@shared/components/Toast";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useCelebration } from "@shared/components/Celebration";

const MIN_DATE = "2026-02-09";
const INITIAL_HISTORY_MONTHS = 6;
const HISTORY_CHUNK_MONTHS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Haptic ────────────────────────────────────────────────────────────────────
const HAPTIC: Record<string, number | number[]> = {
  tap: 8,
  select: 12,
  success: [18, 30, 18],
  warning: [28, 40, 28],
  error: [50, 40, 50],
};
function haptic(kind: keyof typeof HAPTIC = "tap") {
  if (!navigator.vibrate) return;
  navigator.vibrate(HAPTIC[kind] as number | number[]);
}

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

function labelFor(date: string): string {
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
  hideNav,
}: {
  config: NutritionConfig;
  date: string;
  onDateChange: (date: string) => void;
  onSaved?: () => void;
  hideNav?: boolean;
}) {
  const toast = useToast();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editField, setEditField] = useState<"calories" | "protein" | null>(null);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const celebration = useCelebration();
  const [navDir, setNavDir] = useState<"forward" | "backward" | null>(null);

  const calInputRef = useRef<HTMLInputElement>(null);
  const protInputRef = useRef<HTMLInputElement>(null);
  const calNumRef = useRef<HTMLElement>(null);
  const protNumRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingCountUp = useRef(false);
  const isNavigating = useRef(false);
  const countUpSignal = useRef<{ cancelled: boolean }>({ cancelled: false });

  const todayStr = defaultLogDate();
  const isToday = date === todayStr;

  // Load entry when date changes
  useEffect(() => {
    let active = true;
    setEditField(null);
    // Only show skeleton if data takes longer than the slide animation
    const skeletonTimer = setTimeout(() => { if (active) setLoading(true); }, 300);
    getEntry(date)
      .then((entry) => {
        if (!active) return;
        clearTimeout(skeletonTimer);
        setCalories(entry?.calories != null ? String(entry.calories) : "");
        setProtein(entry?.protein != null ? String(entry.protein) : "");
        setLoading(false);
        if (!isNavigating.current) pendingCountUp.current = true;
        isNavigating.current = false;
      })
      .catch((e) => {
        if (!active) return;
        clearTimeout(skeletonTimer);
        toast(String(e?.message ?? e), "error");
        setLoading(false);
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

  // Focus right input when edit opens
  useEffect(() => {
    if (editField === "calories") {
      setTimeout(() => { calInputRef.current?.focus(); calInputRef.current?.select(); }, 40);
    } else if (editField === "protein") {
      setTimeout(() => { protInputRef.current?.focus(); protInputRef.current?.select(); }, 40);
    }
  }, [editField]);

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

  // Swipe gesture for day navigation
  useEffect(() => {
    const el = containerRef.current;
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
      if (editField !== null || calendarOpen || false) { cancelled = true; return; }
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!tracking) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 8) tracking = true;
        else if (Math.abs(dy) > 8) { cancelled = true; return; }
        else return;
      }
      // Claim the horizontal gesture so Shell's tab-swipe never fires here.
      e.preventDefault();
      e.stopPropagation();
    }
    function onTouchEnd(e: TouchEvent) {
      if (!tracking) { tracking = false; cancelled = false; return; }
      tracking = false; cancelled = false;
      e.stopPropagation();
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      if (dx < 0 && !isToday) {
        haptic("select"); navigate(shiftDate(date, 1));
      } else if (dx > 0) {
        const prev = shiftDate(date, -1);
        if (prev >= MIN_DATE) { haptic("select"); navigate(prev); }
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [date, editField, calendarOpen, isToday, onDateChange]);

  const targets = useMemo(() => targetsFromConfig(config), [config]);
  const calNum = Number(calories) || 0;
  const protNum = Number(protein) || 0;
  const hasEntry = calories !== "" || protein !== "";
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
    setEditField(field);
  }

  async function doSave(calN: number, protN: number) {
    if (saving) return;
    setSaving(true);
    try {
      await saveEntry(date, { calories: calN, protein: protN }, config);
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 750);
      haptic("success");
      setEditField(null);
      pendingCountUp.current = true;
      onSaved?.();

      const calRes = getCalorieResult(calN, targets.tdee, targets.deficitTarget);
      const protRes = getProteinResult(protN, targets.proteinTarget);
      const variant = calRes.state === "on-plan" && protRes.celebrated ? "double-hit" : "logged";
      celebration.celebrate(variant);
    } catch (e) {
      haptic("error");
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    doSave(Number(calories) || 0, Number(protein) || 0);
  }

  function handleDelete() {
    if (deleting) return;
    const prevCalories = calories;
    const prevProtein = protein;
    const UNDO_MS = 5000;
    let undone = false;
    setCalories("");
    setProtein("");
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
      },
    });
  }

  // Calorie note
  const calNote = (() => {
    if (!hasEntry) return `Target ${targets.calorieTarget.toLocaleString()} kcal`;
    if (calResult.isSurplus) return `+${calResult.surplus.toLocaleString()} kcal surplus`;
    if (calResult.state === "under") {
      const short = targets.deficitTarget - calResult.deficit;
      return `${short.toLocaleString()} kcal short`;
    }
    if (calResult.state === "on-plan") return "✓ On Plan";
    if (calResult.state === "over") {
      const below = calResult.deficit - targets.deficitTarget;
      return `${below.toLocaleString()} kcal below budget`;
    }
    if (calResult.state === "extreme") return "Well below target";
    return "";
  })();

  // Protein note — protein is a one-sided floor: only the shortfall drives a
  // decision (eat more). Above the target there's nothing to act on, so we
  // don't dress "over" up as a delta. Just: how much more, or done.
  const protNote = (() => {
    if (!hasEntry) return `Target ${targets.proteinTarget}g`;
    const gap = targets.proteinTarget - protNum;
    if (gap > 0) return `${gap}g to go`;
    return "✓ Target met";
  })();

  const calTone = hasEntry
    ? calResult.isSurplus ? "tone-bad"
    : calResult.state === "extreme" ? "tone-bad"
    : calResult.state === "on-plan" ? "tone-good"
    : ""
    : "";

  // Day status badge (Today card, top-right). A pill only earns its place when
  // it says something the per-row notes don't. "On Plan"/"Surplus"/"Low"/
  // "Tracking" just restate calNote — so the only pill left is the reward the
  // notes can't carry: Double Hit.
  const dayStatus = hasEntry && doubleHit ? { label: "Double Hit", tone: "gold" } : null;

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
          onClose={() => setCalendarOpen(false)}
          closing={calendarT.closing}
        />
      )}

      {celebration.node}

      {/* Date navigation */}
      {!hideNav && <nav className="nutri-datenav" aria-label="Diet day navigation">
        <button
          className="nutri-navbtn"
          type="button"
          aria-label="Previous day"
          disabled={shiftDate(date, -1) < MIN_DATE}
          onClick={() => {
            const prev = shiftDate(date, -1);
            if (prev >= MIN_DATE) { haptic("select"); navigate(prev); }
          }}
        >‹</button>
        <button
          className="nutri-date"
          type="button"
          onClick={() => { haptic("tap"); setCalendarOpen(true); }}
        >
          <span
            key={date}
            className={navDir === "forward" ? "date-slide-forward" : navDir === "backward" ? "date-slide-backward" : ""}
          >
            {labelFor(date)}
          </span>
        </button>
        <button
          className="nutri-navbtn"
          type="button"
          aria-label="Next day"
          disabled={isToday}
          onClick={() => {
            if (!isToday) { haptic("select"); navigate(shiftDate(date, 1)); }
          }}
        >›</button>
      </nav>}


      {/* Daily card */}
      <section
        key={date}
        className={[
          "page-card daily-card",
          loading ? "loading-card" : "",
          isEditing ? "is-editing" : "",
          !hasEntry ? "is-empty" : "",
          doubleHit ? "double-hit" : "",
          hideNav ? "is-compact" : "",
          savedPulse ? "saved-pulse" : "",
          navDir === "forward" ? "day-nav-forward" : navDir === "backward" ? "day-nav-backward" : "",
        ].filter(Boolean).join(" ")}
      >
        <div className="daily-card-top">
          <h2 className="daily-card-heading">{isToday ? "Today" : labelFor(date)}</h2>
          <div className="daily-card-top-right">
            {!hasEntry && !isEditing && (
              <span className="dc-pill dc-pill--empty">No entry</span>
            )}
            {dayStatus && !isEditing && (
              <span className={`dc-pill dc-pill--status dc-pill--${dayStatus.tone}`}>
                <span className="dc-pill-dot" aria-hidden />
                {dayStatus.label}
              </span>
            )}
          </div>
        </div>

        {isEditing ? (
          /* ── Inline entry form ── */
          <div className="settlement-form">
            <label className="sf-input-card">
              <span className="sf-label">Calories</span>
              <div className="sf-row">
                <input
                  ref={calInputRef}
                  type="number"
                  inputMode="numeric"
                  value={calories}
                  placeholder="0"
                  onChange={(e) => {
                    let digits = e.target.value.replace(/\D/g, "");
                    if (digits.length > 4) digits = digits.slice(0, 4);
                    setCalories(digits);
                    if (digits.length === 4) {
                      protInputRef.current?.focus();
                      protInputRef.current?.select();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editField === "calories") {
                        setEditField("protein");
                      } else {
                        handleSave();
                      }
                    }
                    if (e.key === "Escape") { haptic("tap"); setEditField(null); }
                  }}
                />
                <span className="sf-unit">kcal</span>
              </div>
            </label>
            <label className="sf-input-card">
              <span className="sf-label">Protein</span>
              <div className="sf-row">
                <input
                  ref={protInputRef}
                  type="number"
                  inputMode="numeric"
                  value={protein}
                  placeholder="0"
                  onChange={(e) => {
                    let digits = e.target.value.replace(/\D/g, "");
                    if (digits.length > 3) digits = digits.slice(0, 3);
                    setProtein(digits);
                    if (digits.length === 3) {
                      doSave(Number(calories) || 0, Number(digits));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                    if (e.key === "Escape") { haptic("tap"); setEditField(null); }
                  }}
                />
                <span className="sf-unit">g</span>
              </div>
            </label>
            <div className="sf-actions">
              <button
                className="nutri-save"
                type="button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : hasEntry ? "Update entry" : "Save entry"}
              </button>
              <div className="sf-secondary">
                {hasEntry && (
                  <button
                    className="sf-delete-link"
                    type="button"
                    onClick={() => { haptic("warning"); handleDelete(); }}
                  >
                    Delete entry
                  </button>
                )}
                <button
                  className="sf-cancel-link"
                  type="button"
                  onClick={() => { haptic("tap"); setEditField(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ── Stat rows ── */
          <div className="daily-metrics">
            {hasEntry ? (
              <>
                <button
                  className="stat-row"
                  type="button"
                  aria-label="Edit calories"
                  onClick={() => openEdit("calories")}
                >
                  <span className="stat-main">
                    <span ref={calNumRef} className={`stat-number ${calTone}`}>
                      {calNum.toLocaleString()}
                    </span>
                    <span className="stat-unit">kcal</span>

                  </span>
                  <span className="stat-label">Calories</span>
                  <span className={`stat-note${calResult.isSurplus || calResult.state === "extreme" ? " stat-note--warn" : calResult.state === "on-plan" ? " stat-note--good" : ""}`}>
                    {calNote}
                  </span>
                </button>
                <button
                  className="stat-row"
                  type="button"
                  aria-label="Edit protein"
                  onClick={() => openEdit("protein")}
                >
                  <span className="stat-main">
                    <span ref={protNumRef} className={`stat-number${protResult.celebrated ? " tone-good" : ""}`}>
                      {protNum}
                    </span>
                    <span className="stat-unit">g</span>
                  </span>
                  <span className="stat-label">Protein</span>
                  <span className={`stat-note${protResult.celebrated ? " stat-note--good" : ""}`}>
                    {protNote}
                  </span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="stat-row stat-row--empty"
                  type="button"
                  aria-label="Log calories"
                  onClick={() => openEdit("calories")}
                >
                  <span className="stat-main">
                    <span className="stat-number--empty">—</span>
                    <span className="stat-unit">kcal</span>
                  </span>
                  <span className="stat-label">Calories</span>
                  <span className="stat-note">Target {targets.calorieTarget.toLocaleString()} kcal</span>
                </button>
                <button
                  className="stat-row stat-row--empty"
                  type="button"
                  aria-label="Log protein"
                  onClick={() => openEdit("protein")}
                >
                  <span className="stat-main">
                    <span className="stat-number--empty">—</span>
                    <span className="stat-unit">g</span>
                  </span>
                  <span className="stat-label">Protein</span>
                  <span className="stat-note">Target {targets.proteinTarget}g</span>
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
