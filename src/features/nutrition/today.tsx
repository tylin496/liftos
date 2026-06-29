import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEntry, saveEntry, deleteEntry, targetsFromConfig, type NutritionConfig } from "./api";
import { defaultLogDate, getCalorieResult, getProteinResult, toDateStr } from "./logic";
import { useToast } from "@shared/components/Toast";

const MIN_DATE = "2026-02-09";
const INITIAL_HISTORY_MONTHS = 6;
const HISTORY_CHUNK_MONTHS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function buildCalendarWeeks(
  todayStr: string,
  historyMonths: number,
  selectedDate: string
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
}: {
  selected: string;
  todayStr: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const [historyMonths, setHistoryMonths] = useState(INITIAL_HISTORY_MONTHS);
  const [visibleMonth, setVisibleMonth] = useState(selected.slice(0, 7));
  const gridRef = useRef<HTMLDivElement>(null);
  const isExtendingRef = useRef(false);

  const weeks = useMemo(
    () => buildCalendarWeeks(todayStr, historyMonths, selected),
    [todayStr, historyMonths, selected]
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

  return (
    <>
      <div className="ncal-backdrop" onClick={onClose} />
      <div className="ncal-panel" role="dialog" aria-modal aria-label="Date picker">
        <div className="ncal-header">
          <span className="ncal-month-label">{monthLabel}</span>
          <button
            className="ncal-today-btn"
            type="button"
            onClick={() => {
              onSelect(todayStr);
              onClose();
            }}
          >
            Today
          </button>
          <button className="ncal-close-btn" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ncal-weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
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
                      onClick={() => {
                        onSelect(dateStr);
                        onClose();
                      }}
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
    </>
  );
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function labelFor(date: string): string {
  if (date === defaultLogDate() || date === toDateStr(new Date())) return "Today";
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function pillLabel(state: string, isSurplus: boolean): string {
  if (isSurplus) return "Surplus";
  if (state === "on-plan") return "On Plan";
  if (state === "over" || state === "extreme") return "Over";
  return "Under";
}

function EntryOverlay({
  date,
  initialCalories,
  initialProtein,
  hasEntry,
  onSave,
  onDelete,
  onClose,
}: {
  date: string;
  initialCalories: string;
  initialProtein: string;
  hasEntry: boolean;
  onSave: (calories: string, protein: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [calories, setCalories] = useState(initialCalories);
  const [protein, setProtein] = useState(initialProtein);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const calRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    calRef.current?.focus();
    calRef.current?.select();
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(calories, protein);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="entry-backdrop" onClick={onClose} />
      <div className="entry-sheet" role="dialog" aria-modal aria-label="Log entry">
        <div className="entry-sheet-handle" />
        <div className="entry-sheet-date">{labelFor(date)}</div>
        <div className="entry-fields">
          <label className="entry-field">
            <span className="entry-field-label">Calories</span>
            <div className="entry-field-row">
              <input
                ref={calRef}
                type="number"
                inputMode="numeric"
                value={calories}
                placeholder="0"
                onChange={(e) => setCalories(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <span className="entry-field-unit">kcal</span>
            </div>
          </label>
          <label className="entry-field">
            <span className="entry-field-label">Protein</span>
            <div className="entry-field-row">
              <input
                type="number"
                inputMode="numeric"
                value={protein}
                placeholder="0"
                onChange={(e) => setProtein(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <span className="entry-field-unit">g</span>
            </div>
          </label>
        </div>
        <button className="nutri-save" onClick={handleSave} disabled={saving || deleting}>
          {saving ? "Saving…" : hasEntry ? "Update" : "Save"}
        </button>
        <div className="entry-sheet-secondary">
          <button className="entry-cancel-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          {hasEntry && (
            <button
              className="entry-delete-btn"
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? "Deleting…" : "Delete entry"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function TodayView({ config }: { config: NutritionConfig }) {
  const toast = useToast();
  const [date, setDate] = useState(defaultLogDate());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedPulse, setSavedPulse] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getEntry(date)
      .then((entry) => {
        if (!active) return;
        setCalories(entry?.calories != null ? String(entry.calories) : "");
        setProtein(entry?.protein != null ? String(entry.protein) : "");
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        toast(String(e?.message ?? e), "error");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date]);

  const targets = useMemo(() => targetsFromConfig(config), [config]);
  const calNum = Number(calories) || 0;
  const protNum = Number(protein) || 0;
  const calResult = getCalorieResult(calNum, targets.tdee, targets.deficitTarget);
  const protResult = getProteinResult(protNum, targets.proteinTarget);
  const hasEntry = calories !== "" || protein !== "";

  // Progress toward calorie budget (0–100%), not deficit progress
  const calorieProgress =
    targets.calorieTarget > 0
      ? Math.min(100, Math.round((calNum / targets.calorieTarget) * 100))
      : 0;

  async function handleSave(cal: string, prot: string) {
    const calN = Number(cal) || 0;
    const protN = Number(prot) || 0;
    await saveEntry(date, { calories: calN, protein: protN }, config);
    setCalories(cal);
    setProtein(prot);
    toast("Saved", "success");
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 750);
  }

  async function handleDelete() {
    await deleteEntry(date);
    setCalories("");
    setProtein("");
    toast("Entry deleted", "info");
  }

  const pillState = calResult.isSurplus ? "surplus" : calResult.state;

  return (
    <>
      {calendarOpen && (
        <NutriCalendar
          selected={date}
          todayStr={defaultLogDate()}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {entryOpen && (
        <EntryOverlay
          date={date}
          initialCalories={calories}
          initialProtein={protein}
          hasEntry={hasEntry}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEntryOpen(false)}
        />
      )}

      {/* Date navigation */}
      <div className="nutri-datenav">
        <button className="nutri-navbtn" onClick={() => setDate(shiftDate(date, -1))}>
          ‹
        </button>
        <button className="nutri-date" onClick={() => setCalendarOpen(true)}>
          {labelFor(date)}
        </button>
        <button
          className="nutri-navbtn"
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= defaultLogDate()}
        >
          ›
        </button>
      </div>

      {/* Unified daily card — tap to log */}
      <button
        className={`page-card nutri-hero nutri-tap-card${savedPulse ? " saved-pulse" : ""}`}
        onClick={() => !loading && setEntryOpen(true)}
        aria-label="Log nutrition"
        disabled={loading}
      >
        {/* Status pill — only visible after an entry exists */}
        {hasEntry && (
          <div className="nutri-pill-row">
            <span className={`nutri-pill nutri-pill-${pillState}`}>
              {pillLabel(calResult.state, calResult.isSurplus)}
            </span>
          </div>
        )}

        {/* Calorie hero — shows actual kcal consumed, coloured by state */}
        <div className={`nutri-hero-num-row state-${calResult.state}`}>
          <span className="nutri-hero-num">
            {calNum === 0 && !hasEntry ? (
              <span className="nutri-empty">—</span>
            ) : (
              calNum.toLocaleString()
            )}
          </span>
          <span className="nutri-hero-unit-lg">kcal</span>
        </div>

        {/* Calorie settlement: progress bar + deficit/surplus label */}
        <div className="nutri-settle">
          <div className="nutri-settle-head">
            <span className="nutri-settle-label">Calories</span>
            <span className={`nutri-settle-delta state-${calResult.state}`}>
              {hasEntry
                ? calResult.isSurplus
                  ? `+${calResult.surplus.toLocaleString()} surplus`
                  : `−${calResult.deficit.toLocaleString()} deficit`
                : `Target ${targets.calorieTarget.toLocaleString()} kcal`}
            </span>
          </div>
          <div className="nutri-bar">
            <div
              className={`nutri-bar-fill state-${calResult.state}`}
              style={{ width: `${hasEntry ? calorieProgress : 0}%` }}
            />
          </div>
          <span className="nutri-settle-note">
            {hasEntry
              ? `${calNum.toLocaleString()} / ${targets.calorieTarget.toLocaleString()} kcal · TDEE ${targets.tdee.toLocaleString()}`
              : `TDEE ${targets.tdee.toLocaleString()} kcal`}
          </span>
        </div>

        {/* Divider */}
        <div className="nutri-divider" />

        {/* Protein section */}
        <div className="nutri-protein-section">
          <div className="nutri-settle-head">
            <span className="nutri-settle-label">Protein</span>
            <span
              className={`nutri-settle-delta${protResult.celebrated ? " state-on-plan" : ""}`}
            >
              {hasEntry
                ? protResult.celebrated
                  ? "Goal met ✓"
                  : `${Math.round(Math.max(0, targets.proteinTarget - protNum))}g to go`
                : `Target ${targets.proteinTarget}g`}
            </span>
          </div>
          <div className="nutri-protein-num-row">
            <span
              className={`nutri-protein-num${protResult.celebrated ? " state-on-plan" : ""}`}
            >
              {protNum === 0 && !hasEntry ? (
                <span className="nutri-empty">—</span>
              ) : (
                protNum
              )}
            </span>
            <span className="nutri-protein-unit">/ {targets.proteinTarget} g</span>
          </div>
          <div className="nutri-bar" style={{ marginTop: "var(--space-2)" }}>
            <div
              className={`nutri-bar-fill ${protResult.celebrated ? "state-on-plan" : "state-under"}`}
              style={{ width: `${hasEntry ? protResult.progress : 0}%` }}
            />
          </div>
        </div>
      </button>
    </>
  );
}
