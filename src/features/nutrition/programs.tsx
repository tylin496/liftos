import { useState } from "react";
import { saveConfig, type NutritionConfig } from "./api";
import { phaseFromDeficit } from "./logic";

export function ProgramsView({
  config,
  onSaved,
}: {
  config: NutritionConfig;
  onSaved: (c: NutritionConfig) => void;
}) {
  const raw = config.phase_deficits;
  const initDeficit = Number(Array.isArray(raw) ? raw[0] : (raw ?? 500));
  const initCalorieTarget = Math.max(0, config.tdee - initDeficit);

  const [protein, setProtein] = useState(String(config.protein_target));
  const [calorieTarget, setCalorieTarget] = useState(String(initCalorieTarget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const calorieTargetNum = Math.max(0, Number(calorieTarget) || 0);
  const deficitNum = Math.max(0, Math.round(config.tdee - calorieTargetNum));
  const phaseName = phaseFromDeficit(deficitNum);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveConfig({
        tdee: config.tdee,
        protein_target: Math.round(Number(protein) || 0),
        phase_deficits: [deficitNum],
      });
      onSaved(updated);
      setSavedAt(Date.now());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="nutri">
      <section className="page-card nutri-form">
        <p className="page-eyebrow">Maintenance</p>
        <div className="nutri-field">
          <span>TDEE (kcal/day)</span>
          <span className="nutri-field-auto">{config.tdee.toLocaleString()} · auto</span>
        </div>
        <label className="nutri-field">
          <span>Protein target (g)</span>
          <input
            type="number"
            inputMode="numeric"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
          />
        </label>
      </section>

      <section className="page-card nutri-form">
        <p className="page-eyebrow">Cut target</p>
        <label className="nutri-field">
          <span>Calorie target (kcal/day)</span>
          <input
            type="number"
            inputMode="numeric"
            value={calorieTarget}
            onChange={(e) => setCalorieTarget(e.target.value)}
          />
        </label>
        <div className="prog-phase-derived">
          <span className="prog-phase-name">{phaseName}</span>
          <span className="prog-phase-target">−{deficitNum.toLocaleString()} kcal deficit</span>
        </div>
      </section>

      <section className="page-card nutri-form">
        <button className="nutri-save" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save program"}
        </button>
        {savedAt && !error && <p className="prog-saved">Saved ✓</p>}
        {error && <p className="auth-error">{error}</p>}
      </section>
    </div>
  );
}
