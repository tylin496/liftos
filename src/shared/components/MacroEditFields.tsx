import { useEffect, useRef } from "react";
import "./macroEditFields.css";

export type MacroField = "calories" | "protein";

// A leading +/- turns the field into a relative adjustment against the
// original saved value (e.g. "760" + typing "+12" -> 772 on save) instead of
// a literal overwrite. Only meaningful when editing an existing entry.
function sanitizeDigits(raw: string, maxDigits: number, allowSign: boolean): string {
  const sign = allowSign && (raw[0] === "+" || raw[0] === "-") ? raw[0] : "";
  const digits = raw.slice(sign.length).replace(/\D/g, "").slice(0, maxDigits);
  return sign + digits;
}

function resolveValue(raw: string, original: number, hasEntry: boolean): number {
  if (hasEntry && /^[+-]\d+$/.test(raw)) {
    return Math.max(0, original + Number(raw));
  }
  return Number(raw) || 0;
}

// Tap-to-edit keypad entry for the daily Calories/Protein pair, shared by
// Overview's Hero card and Nutrition's Today card (same underlying daily
// entry). Typing the 4th calorie digit auto-advances to Protein; typing the
// 3rd protein digit auto-submits — callers just supply current values +
// setters and get the save call with the freshly-typed digits (not stale
// state) so the auto-submit doesn't race a pending setState. A leading +/-
// (only offered once an entry exists) opts out of the digit-count shortcuts
// since the field no longer represents a finished absolute value.
export function MacroEditFields({
  calories,
  protein,
  onCaloriesChange,
  onProteinChange,
  activeField,
  onActiveFieldChange,
  onSave,
  onCancel,
  onDelete,
  saving,
  hasEntry,
  originalCalories,
  originalProtein,
  error,
}: {
  calories: string;
  protein: string;
  onCaloriesChange: (v: string) => void;
  onProteinChange: (v: string) => void;
  activeField: MacroField;
  onActiveFieldChange: (f: MacroField) => void;
  onSave: (calories: number, protein: number) => void;
  onCancel: () => void;
  onDelete?: () => void;
  saving?: boolean;
  hasEntry: boolean;
  /** Base values a leading +/- delta is applied against. */
  originalCalories?: number;
  originalProtein?: number;
  /** Persists until the next save attempt — a 5s toast alone is easy to miss
      and would otherwise leave the user believing the entry saved. */
  error?: string | null;
}) {
  const calInputRef = useRef<HTMLInputElement>(null);
  const protInputRef = useRef<HTMLInputElement>(null);
  const resolvedCalories = () => resolveValue(calories, originalCalories ?? 0, hasEntry);
  const resolvedProtein = () => resolveValue(protein, originalProtein ?? 0, hasEntry);

  useEffect(() => {
    if (activeField === "calories") {
      setTimeout(() => { calInputRef.current?.focus(); calInputRef.current?.select(); }, 40);
    } else {
      setTimeout(() => { protInputRef.current?.focus(); protInputRef.current?.select(); }, 40);
    }
    // Only re-run when the active field changes (or on mount) — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeField]);

  return (
    <div className="settlement-form">
      <label className="sf-input-card" onClick={() => onActiveFieldChange("calories")}>
        <span className="sf-label">Calories</span>
        <div className="sf-row">
          <input
            ref={calInputRef}
            type="number"
            inputMode="numeric"
            value={calories}
            placeholder="0"
            onChange={(e) => {
              const next = sanitizeDigits(e.target.value, 4, hasEntry);
              onCaloriesChange(next);
              if (/^\d{4}$/.test(next)) {
                onActiveFieldChange("protein");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (activeField === "calories") onActiveFieldChange("protein");
                else onSave(resolvedCalories(), resolvedProtein());
              }
              if (e.key === "Escape") onCancel();
            }}
          />
          <span className="sf-unit">kcal</span>
        </div>
      </label>
      <label className="sf-input-card" onClick={() => onActiveFieldChange("protein")}>
        <span className="sf-label">Protein</span>
        <div className="sf-row">
          <input
            ref={protInputRef}
            type="number"
            inputMode="numeric"
            value={protein}
            placeholder="0"
            onChange={(e) => {
              const next = sanitizeDigits(e.target.value, 3, hasEntry);
              onProteinChange(next);
              if (/^\d{3}$/.test(next)) {
                onSave(resolvedCalories(), resolveValue(next, originalProtein ?? 0, hasEntry));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(resolvedCalories(), resolvedProtein());
              if (e.key === "Escape") onCancel();
            }}
          />
          <span className="sf-unit">g</span>
        </div>
      </label>
      <div className="sf-actions">
        <button
          className="nutri-save"
          type="button"
          onClick={() => onSave(resolvedCalories(), resolvedProtein())}
          disabled={saving}
        >
          {saving ? "Saving…" : hasEntry ? "Update entry" : "Save entry"}
        </button>
        {error && <p className="sf-error">{error}</p>}
        <div className="sf-secondary">
          {onDelete && (
            <button className="sf-delete-link" type="button" onClick={onDelete}>
              Delete entry
            </button>
          )}
          <button className="sf-cancel-link" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
