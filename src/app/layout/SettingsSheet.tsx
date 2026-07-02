import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useToast } from "@shared/components/Toast";
import { signOut } from "@shared/lib/auth";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
import { saveConfig, targetsFromConfig, phaseDefsFromConfig } from "@features/nutrition/api";
import { phaseFromDeficit, trainingMonthsFromStart } from "@features/nutrition/logic";
import { useTheme, type ThemePreference } from "@shared/lib/theme";
import logoUrl from "@shared/assets/logo.png";
import { version as APP_VERSION } from "../../../package.json";

type RowKey = "protein" | "intake" | "height" | "start" | "bf";

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function AppearanceToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="settings-appearance-seg" role="group" aria-label="Appearance">
      {APPEARANCE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`settings-appearance-btn${theme === opt.value ? " is-active" : ""}`}
          aria-label={opt.label}
          aria-pressed={theme === opt.value}
          onClick={() => setTheme(opt.value)}
        >
          {opt.value === "light" && (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          )}
          {opt.value === "dark" && (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
            </svg>
          )}
          {opt.value === "system" && (
            <svg viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 2a6 6 0 010 12z" fill="currentColor" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Stepper({
  value,
  step,
  onChange,
}: {
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings-stepper">
      <button type="button" onClick={() => onChange(value - step)} aria-label="Decrease">
        −
      </button>
      <span className="num">{value}</span>
      <button type="button" onClick={() => onChange(value + step)} aria-label="Increase">
        +
      </button>
    </div>
  );
}

function SheetInner({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { config, setConfig } = useNutritionConfig();
  const toast = useToast();

  const [protein, setProtein] = useState("");
  const [currentIntake, setCurrentIntake] = useState("");
  const [height, setHeight] = useState("");
  const [trainingStartDate, setTrainingStartDate] = useState("");
  const [targetBf, setTargetBf] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<RowKey | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus trap + Escape-to-close. aria-modal promises the rest of the page is
  // inert while this is open — without this, a keyboard/switch-control user
  // could Tab straight out of the sheet into the page behind the scrim.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    function focusables(): HTMLElement[] {
      return Array.from(
        sheet!.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    // Move focus in on open so a keyboard user starts inside the sheet.
    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Swipe-down-to-dismiss on the grabber/header — the grabber otherwise
  // implies a drag affordance it doesn't honor. Direct DOM writes during the
  // drag (not React state) keep it smooth; onClose fires only once the
  // manual slide-out has visually finished.
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  // Velocity sampling so a quick flick-down dismisses even below the 90px
  // distance threshold. prev trails last by one move (see useHorizontalSwipe).
  const dragPrevY = useRef(0);
  const dragPrevT = useRef(0);
  const dragLastY = useRef(0);
  const dragLastT = useRef(0);

  function onDragStart(e: ReactTouchEvent) {
    dragStartY.current = e.touches[0].clientY;
    dragPrevY.current = dragLastY.current = e.touches[0].clientY;
    dragPrevT.current = dragLastT.current = e.timeStamp;
    isDragging.current = true;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.classList.add("is-dragging");
    }
  }
  function onDragMove(e: ReactTouchEvent) {
    if (!isDragging.current || !sheetRef.current) return;
    dragPrevY.current = dragLastY.current;
    dragPrevT.current = dragLastT.current;
    dragLastY.current = e.touches[0].clientY;
    dragLastT.current = e.timeStamp;
    const dy = Math.max(0, e.touches[0].clientY - dragStartY.current);
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onDragEnd(e: ReactTouchEvent) {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const endY = e.changedTouches[0].clientY;
    const dy = Math.max(0, endY - dragStartY.current);
    const dt = e.timeStamp - dragPrevT.current;
    const vy = dt > 0 ? (endY - dragPrevY.current) / dt : 0;
    // Dismiss on enough travel OR a quick downward flick.
    const flickedDown = vy >= 0.5 && dy >= 12;
    const el = sheetRef.current;
    el.style.transition = "transform 200ms ease";
    if (dy > 90 || flickedDown) {
      el.style.transform = "translateY(100%)";
      setTimeout(() => onCloseRef.current(), 200);
    } else {
      el.style.transform = "";
      setTimeout(() => {
        el.style.transition = "";
        el.classList.remove("is-dragging");
      }, 200);
    }
  }
  // touchcancel (system gesture / incoming call) skips onDragEnd — without this
  // the sheet stays frozen mid-drag with transition:none. Snap it back to rest.
  function onDragCancel() {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const el = sheetRef.current;
    el.style.transition = "transform 200ms ease";
    el.style.transform = "";
    setTimeout(() => {
      el.style.transition = "";
      el.classList.remove("is-dragging");
    }, 200);
  }

  useEffect(() => {
    if (!config) return;
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setCurrentIntake(String(t.calorieTarget));
    setHeight(config.height_cm == null ? "" : String(config.height_cm));
    setTrainingStartDate(config.training_start_date ?? "");
    setTargetBf(config.target_body_fat_pct == null ? "" : String(config.target_body_fat_pct));
  }, [config]);

  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const liveTrainingMonths = trainingMonthsFromStart(trainingStartDate);
  const intake = Math.max(0, Number(currentIntake) || 0);
  const liveDeficit = Math.max(0, Math.round((config?.tdee ?? 0) - intake));
  const livePhaseName = phaseFromDeficit(liveDeficit);

  function editRow(row: RowKey) {
    setEditingRow((cur) => (cur === row ? null : row));
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const { defs: savedDefs } = phaseDefsFromConfig(config);
      const updated = await saveConfig({
        protein_target: Math.round(Number(protein) || config.protein_target),
        phase_deficits: [...savedDefs, intake] as unknown as any,
        height_cm: numOrNull(height),
        training_start_date: trainingStartDate || null,
        target_body_fat_pct: numOrNull(targetBf),
      });
      setConfig(updated);
      setEditingRow(null);
      toast("Settings saved", "success");
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <div
          className="settings-sheet-grabber"
          aria-hidden
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragCancel}
        />
        <div
          className="settings-sheet-header"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragCancel}
        >
          <span className="settings-sheet-title">Settings</span>
          <div className="settings-sheet-header-actions">
            <AppearanceToggle />
            <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="settings-sheet-body">
          <p className="settings-section-label">Nutrition</p>
          <div className="settings-group">
            <div className={`settings-row${editingRow === "protein" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Protein target</span>
              {editingRow === "protein" ? (
                <Stepper value={Number(protein) || 0} step={5} onChange={(v) => setProtein(String(Math.max(0, v)))} />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("protein")}
                >
                  <span className="settings-row-val">
                    {protein}
                    <span className="u">g</span>
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
            <div className={`settings-row${editingRow === "intake" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Intake goal</span>
              {editingRow === "intake" ? (
                <Stepper
                  value={Number(currentIntake) || 0}
                  step={50}
                  onChange={(v) => setCurrentIntake(String(Math.max(0, v)))}
                />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("intake")}
                >
                  <span className="settings-row-val">
                    {Number(currentIntake).toLocaleString()}
                    <span className="u">kcal</span>
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="settings-phase">
            <span className="settings-phase-l">
              <span className="k">Phase</span>
              <span className="v">{livePhaseName}</span>
            </span>
            <span className="settings-phase-def">−{liveDeficit.toLocaleString()} kcal deficit</span>
          </div>

          <p className="settings-section-label settings-section-label--spaced">Profile</p>
          <div className="settings-group">
            <div className={`settings-row${editingRow === "height" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Height</span>
              {editingRow === "height" ? (
                <input
                  className="settings-row-input"
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  placeholder="—"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  onBlur={() => setEditingRow(null)}
                />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("height")}
                >
                  <span className={`settings-row-val${height ? "" : " placeholder"}`}>
                    {height ? (
                      <>
                        {height}
                        <span className="u">cm</span>
                      </>
                    ) : (
                      "Set"
                    )}
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
            <div className={`settings-row${editingRow === "start" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Training start</span>
              {editingRow === "start" ? (
                <input
                  className="settings-row-input"
                  type="date"
                  autoFocus
                  value={trainingStartDate}
                  onChange={(e) => setTrainingStartDate(e.target.value)}
                  onBlur={() => setEditingRow(null)}
                />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("start")}
                >
                  <span className={`settings-row-val${trainingStartDate ? "" : " placeholder"}`}>
                    {trainingStartDate ? fmtDate(trainingStartDate) : "Set"}
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
            <div className={`settings-row${editingRow === "bf" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Target body fat</span>
              {editingRow === "bf" ? (
                <input
                  className="settings-row-input"
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  placeholder="—"
                  value={targetBf}
                  onChange={(e) => setTargetBf(e.target.value)}
                  onBlur={() => setEditingRow(null)}
                />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("bf")}
                >
                  <span className={`settings-row-val${targetBf ? "" : " placeholder"}`}>
                    {targetBf ? (
                      <>
                        {targetBf}
                        <span className="u">%</span>
                      </>
                    ) : (
                      "Set"
                    )}
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
          </div>
          {liveTrainingMonths !== null && <p className="settings-hint">= {liveTrainingMonths} months of training</p>}

          <button className="nutri-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>

          {error && <p className="auth-error">{error}</p>}

          <button type="button" className="settings-sign-out" onClick={() => void signOut()}>
            Sign out
          </button>

          <div className="settings-about">
            <img className="settings-about-mark" src={logoUrl} alt="" />
            <span className="settings-about-name">LiftOS</span>
            <span className="settings-about-ver">v{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted) return null;
  return <SheetInner closing={closing} onClose={onClose} />;
}
