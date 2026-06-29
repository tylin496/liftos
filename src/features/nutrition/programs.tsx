import { useEffect, useState } from "react";
import { saveConfig, targetsFromConfig, type NutritionConfig } from "./api";
import { phaseFromDeficit } from "./logic";

export function ProgramsView({
  config,
  onSaved,
}: {
  config: NutritionConfig;
  onSaved: (c: NutritionConfig) => void;
}) {
  const targets = targetsFromConfig(config);

  const [editing, setEditing] = useState(false);
  const [protein, setProtein] = useState(String(config.protein_target));
  const [calorieTarget, setCalorieTarget] = useState(String(targets.calorieTarget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync inputs when config changes (e.g. after save)
  useEffect(() => {
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setCalorieTarget(String(t.calorieTarget));
  }, [config]);

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
      setEditing(false);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-card">
      <div className="nutri-section-head">
        <p className="page-eyebrow" style={{ margin: 0 }}>Program</p>
        <button
          className="nutri-section-toggle"
          type="button"
          onClick={() => {
            setEditing((v) => !v);
            setError(null);
          }}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* Summary grid — always visible */}
      <div className="nutri-prog-summary">
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{targets.calorieTarget.toLocaleString()}</span>
          <span className="nutri-prog-label">Cal Target</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{targets.proteinTarget}</span>
          <span className="nutri-prog-label">Protein Target</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val">{config.tdee.toLocaleString()}</span>
          <span className="nutri-prog-label">TDEE</span>
        </div>
        <div className="nutri-prog-item">
          <span className="nutri-prog-val is-text">{targets.cutPhaseName}</span>
          <span className="nutri-prog-label">Phase</span>
        </div>
      </div>

      {/* Edit form — revealed by toggle */}
      {editing && (
        <div className="nutri-prog-edit">
          <div className="nutri-divider" />

          <label className="nutri-field">
            <span>Protein target (g)</span>
            <input
              type="number"
              inputMode="numeric"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
            />
          </label>

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

          <button className="nutri-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save program"}
          </button>

          {error && <p className="auth-error">{error}</p>}
        </div>
      )}
    </section>
  );
}
