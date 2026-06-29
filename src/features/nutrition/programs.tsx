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
  const initDeficit = Array.isArray(raw) ? raw[0] : (raw ?? 500);

  const [tdee, setTdee] = useState(String(config.tdee));
  const [protein, setProtein] = useState(String(config.protein_target));
  const [deficit, setDeficit] = useState(String(initDeficit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const tdeeNum = Number(tdee) || 0;
  const deficitNum = Number(deficit) || 0;
  const calorieTarget = Math.max(0, Math.round(tdeeNum - deficitNum));
  const phaseName = phaseFromDeficit(deficitNum);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveConfig({
        tdee: Math.round(tdeeNum),
        protein_target: Math.round(Number(protein) || 0),
        phase_deficits: [Math.round(deficitNum)],
        active_phase_index: 0,
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
        <label className="nutri-field">
          <span>TDEE (kcal/day)</span>
          <input
            type="number"
            inputMode="numeric"
            value={tdee}
            onChange={(e) => setTdee(e.target.value)}
          />
        </label>
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
          <span>Daily deficit (kcal)</span>
          <input
            type="number"
            inputMode="numeric"
            value={deficit}
            onChange={(e) => setDeficit(e.target.value)}
          />
        </label>
        <div className="prog-phase-derived">
          <span className="prog-phase-name">{phaseName}</span>
          <span className="prog-phase-target">{calorieTarget.toLocaleString()} kcal/day</span>
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
