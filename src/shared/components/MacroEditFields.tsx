import { useEffect, useRef } from "react";
import "./macroEditFields.css";

export type MacroField = "calories" | "protein";

// +/- anywhere in the string is plain arithmetic (e.g. "2312+12" -> 2324 on
// save), not a special delta shortcut — a leading-sign-only delta against the
// original value never actually triggered, since editing an existing entry
// always starts with the old digits already in the field. Each +/- resets
// the per-term digit cap so "2312+12" isn't truncated as if it were one
// 4-digit run.
function sanitizeDigits(raw: string, maxDigits: number): string {
  let out = "";
  let termDigits = 0;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (termDigits >= maxDigits) continue;
      out += ch;
      termDigits++;
    } else if (ch === "+" || ch === "-") {
      const prev = out[out.length - 1];
      if (out.length === 0 || (prev !== "+" && prev !== "-")) {
        out += ch;
        termDigits = 0;
      }
    }
  }
  return out;
}

function resolveValue(raw: string): number {
  const terms = raw.match(/[+-]?\d+/g);
  if (!terms) return 0;
  return Math.max(0, terms.reduce((sum, term) => sum + Number(term), 0));
}

// Tap-to-edit keypad entry for the daily Calories/Protein pair, shared by
// Overview's Hero card and Nutrition's Today card (same underlying daily
// entry). Typing the 4th calorie digit auto-advances to Protein; typing the
// 3rd protein digit auto-submits — callers just supply current values +
// setters and get the save call with the freshly-typed digits (not stale
// state) so the auto-submit doesn't race a pending setState. Those digit-count
// shortcuts only match a pure digit run, so typing an arithmetic expression
// (e.g. "2312+12") falls through to Enter / the Save button instead.
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
  /** Persists until the next save attempt — a 5s toast alone is easy to miss
      and would otherwise leave the user believing the entry saved. */
  error?: string | null;
}) {
  const calInputRef = useRef<HTMLInputElement>(null);
  const protInputRef = useRef<HTMLInputElement>(null);
  const resolvedCalories = () => resolveValue(calories);
  const resolvedProtein = () => resolveValue(protein);

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
            inputMode="text"
            value={calories}
            placeholder="0"
            onChange={(e) => {
              const next = sanitizeDigits(e.target.value, 4);
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
            inputMode="text"
            value={protein}
            placeholder="0"
            onChange={(e) => {
              const next = sanitizeDigits(e.target.value, 3);
              onProteinChange(next);
              if (/^\d{3}$/.test(next)) {
                onSave(resolvedCalories(), resolveValue(next));
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
