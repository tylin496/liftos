import { useEffect, useRef } from "react";
import "./macroEditFields.css";

export type MacroField = "calories" | "protein";

// Tap-to-edit keypad entry for the daily Calories/Protein pair, shared by
// Overview's Hero card and Nutrition's Today card (same underlying daily
// entry). Typing the 4th calorie digit auto-advances to Protein; typing the
// 3rd protein digit auto-submits — callers just supply current values +
// setters and get the save call with the freshly-typed digits (not stale
// state) so the auto-submit doesn't race a pending setState.
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
}) {
  const calInputRef = useRef<HTMLInputElement>(null);
  const protInputRef = useRef<HTMLInputElement>(null);

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
              let digits = e.target.value.replace(/\D/g, "");
              if (digits.length > 4) digits = digits.slice(0, 4);
              onCaloriesChange(digits);
              if (digits.length === 4) {
                onActiveFieldChange("protein");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (activeField === "calories") onActiveFieldChange("protein");
                else onSave(Number(calories) || 0, Number(protein) || 0);
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
              let digits = e.target.value.replace(/\D/g, "");
              if (digits.length > 3) digits = digits.slice(0, 3);
              onProteinChange(digits);
              if (digits.length === 3) {
                onSave(Number(calories) || 0, Number(digits));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(Number(calories) || 0, Number(protein) || 0);
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
          onClick={() => onSave(Number(calories) || 0, Number(protein) || 0)}
          disabled={saving}
        >
          {saving ? "Saving…" : hasEntry ? "Update entry" : "Save entry"}
        </button>
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
