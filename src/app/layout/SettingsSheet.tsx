import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { useToast } from "@shared/components/Toast";
import { signOut } from "@shared/lib/auth";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
import { saveConfig, targetsFromConfig, phaseDefsFromConfig } from "@features/nutrition/api";
import { phaseFromDeficit, trainingMonthsFromStart } from "@features/nutrition/logic";
import { maybeClosePhase } from "@shared/lib/phaseReport";
import { useTheme, type ThemePreference } from "@shared/lib/theme";
import { useIsReadOnly } from "./SessionContext";
import logoUrl from "@shared/assets/logo.png";
import { version as APP_VERSION } from "../../../package.json";

type RowKey = "protein" | "intake" | "targettdee" | "height" | "start" | "bf";

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
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
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
  const readOnly = useIsReadOnly();

  const [protein, setProtein] = useState("");
  const [currentIntake, setCurrentIntake] = useState("");
  const [targetTdee, setTargetTdee] = useState("");
  const [height, setHeight] = useState("");
  const [trainingStartDate, setTrainingStartDate] = useState("");
  const [targetBf, setTargetBf] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<RowKey | null>(null);

  const sheetRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape-to-close. aria-modal promises the rest of the page is
  // inert while this is open — without this, a keyboard/switch-control user
  // could Tab straight out of the sheet into the page behind the scrim.
  useFocusTrap(sheetRef, onClose);

  // Swipe-down-to-dismiss on the grabber/header — the grabber otherwise
  // implies a drag affordance it doesn't honor.
  const { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  useEffect(() => {
    if (!config) return;
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setCurrentIntake(String(t.calorieTarget));
    setTargetTdee(config.target_tdee == null ? "" : String(config.target_tdee));
    setHeight(config.height_cm == null ? "" : String(config.height_cm));
    setTrainingStartDate(config.training_start_date ?? "");
    setTargetBf(config.target_body_fat_pct == null ? "" : String(config.target_body_fat_pct));
  }, [config]);

  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const liveTrainingMonths = trainingMonthsFromStart(trainingStartDate);
  const intake = Math.max(0, Number(currentIntake) || 0);
  // Signed: intake above TDEE gives a negative deficit (surplus → Lean Bulk).
  const liveDeficit = Math.round((config?.tdee ?? 0) - intake);
  const livePhaseName = phaseFromDeficit(liveDeficit);
  const liveDeficitLabel =
    liveDeficit >= 200
      ? `−${liveDeficit.toLocaleString()} kcal deficit`
      : liveDeficit <= -100
        ? `+${(-liveDeficit).toLocaleString()} kcal surplus`
        : "at maintenance";

  function editRow(row: RowKey) {
    if (readOnly) return; // viewers see config values but can't edit them
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
        target_tdee: targetTdee.trim() === "" ? null : Math.round(Number(targetTdee)),
        height_cm: numOrNull(height),
        training_start_date: trainingStartDate || null,
        target_body_fat_pct: numOrNull(targetBf),
      });
      // Intake crossed into a different phase band → settle the ended cut/bulk
      // into its one-time retrospective. Fire-and-forget: a failed report never
      // blocks the save (maybeClosePhase swallows its own errors).
      void maybeClosePhase(config, updated);
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
        className={`settings-sheet${closing ? " is-closing" : ""}${readOnly ? " is-readonly" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <div
          className="settings-sheet-grabber"
          aria-hidden
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        />
        <div
          className="settings-sheet-header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
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
            <div className={`settings-row${editingRow === "targettdee" ? " is-editing" : ""}`}>
              <span className="settings-row-label">Active TDEE goal</span>
              {editingRow === "targettdee" ? (
                <Stepper
                  value={Number(targetTdee) || 0}
                  step={50}
                  onChange={(v) => setTargetTdee(String(Math.max(0, v)))}
                />
              ) : (
                <button
                  type="button"
                  className="settings-row-val-btn"
                  onClick={() => editRow("targettdee")}
                >
                  <span className={`settings-row-val${targetTdee ? "" : " placeholder"}`}>
                    {targetTdee ? (
                      <>
                        {Number(targetTdee).toLocaleString()}
                        <span className="u">kcal</span>
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

          <div className="settings-phase">
            <span className="settings-phase-l">
              <span className="k">Phase</span>
              <span className="v">{livePhaseName}</span>
            </span>
            <span className="settings-phase-def">{liveDeficitLabel}</span>
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
                      "—"
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
                    {trainingStartDate ? fmtDate(trainingStartDate) : "—"}
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
                      "—"
                    )}
                    <span className="chev">›</span>
                  </span>
                </button>
              )}
            </div>
          </div>
          {liveTrainingMonths !== null && <p className="settings-hint">= {liveTrainingMonths} months of training</p>}

          {!readOnly && (
            <button className="nutri-save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}

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
