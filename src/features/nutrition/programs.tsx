import { useEffect, useState } from "react";
import {
  saveConfig,
  targetsFromConfig,
  phaseDefsFromConfig,
  type NutritionConfig,
} from "./api";
import { phaseFromDeficit } from "./logic";
import { useToast } from "@shared/components/Toast";

export function ProgramsView({
  config,
  onSaved,
}: {
  config: NutritionConfig;
  onSaved: (c: NutritionConfig) => void;
}) {
  const toast = useToast();
  const targets = targetsFromConfig(config);
  const { defs: savedDefs } = phaseDefsFromConfig(config);

  const [editing, setEditing] = useState(false);
  const [protein, setProtein] = useState(String(config.protein_target));
  const [currentIntake, setCurrentIntake] = useState(String(targets.calorieTarget));
  const [height, setHeight] = useState(config.height_cm == null ? "" : String(config.height_cm));
  const [trainingAge, setTrainingAge] = useState(
    config.training_age_months == null ? "" : String(config.training_age_months),
  );
  const [targetBf, setTargetBf] = useState(
    config.target_body_fat_pct == null ? "" : String(config.target_body_fat_pct),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setCurrentIntake(String(t.calorieTarget));
    setHeight(config.height_cm == null ? "" : String(config.height_cm));
    setTrainingAge(config.training_age_months == null ? "" : String(config.training_age_months));
    setTargetBf(config.target_body_fat_pct == null ? "" : String(config.target_body_fat_pct));
  }, [config]);

  // "" → null (cleared); otherwise the parsed number, or undefined to leave unchanged on bad input
  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const intake = Math.max(0, Number(currentIntake) || 0);
  const liveDeficit = Math.max(0, Math.round(config.tdee - intake));
  const livePhaseName = phaseFromDeficit(liveDeficit);

  async function handleSaveEdits() {
    setSaving(true);
    setError(null);
    try {
      // Store [...savedDefs, intake] — targetsFromConfig reads last element (≥100) as intake
      const newPhaseDeficits = [...savedDefs, intake] as unknown as number[];
      const updated = await saveConfig({
        protein_target: Math.round(Number(protein) || config.protein_target),
        phase_deficits: newPhaseDeficits as any,
        height_cm: numOrNull(height),
        training_age_months: numOrNull(trainingAge) == null ? null : Math.round(Number(trainingAge)),
        target_body_fat_pct: numOrNull(targetBf),
      });
      onSaved(updated);
      setEditing(false);
      toast("Program saved", "success");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-card">
      <div className="section-head">
        <p className="page-eyebrow" style={{ margin: 0 }}>Program</p>
        <button
          className="nutri-section-toggle"
          type="button"
          onClick={() => { setEditing((v) => !v); setError(null); }}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* Summary grid */}
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

      {/* Edit panel */}
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

          {/* Intake goal */}
          <label className="nutri-field">
            <span>Intake goal (kcal/day)</span>
            <input
              type="number"
              inputMode="numeric"
              value={currentIntake}
              onChange={(e) => setCurrentIntake(e.target.value)}
            />
          </label>

          {/* Profile — improves AI export analysis (all optional) */}
          <label className="nutri-field">
            <span>Height (cm)</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="—"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>

          <label className="nutri-field">
            <span>Training age (months)</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={trainingAge}
              onChange={(e) => setTrainingAge(e.target.value)}
            />
          </label>

          <label className="nutri-field">
            <span>Target body fat (%)</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="—"
              value={targetBf}
              onChange={(e) => setTargetBf(e.target.value)}
            />
          </label>

          {/* Live phase preview */}
          <div className="prog-auto-phase">
            <span className="prog-auto-label">Phase</span>
            <span className="prog-auto-val">{livePhaseName}</span>
            <span className="prog-auto-deficit">−{liveDeficit.toLocaleString()} kcal deficit</span>
          </div>

          <button
            className="nutri-save"
            onClick={handleSaveEdits}
            disabled={saving}
            style={{ marginTop: "var(--space-2)" }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>

          {error && <p className="auth-error">{error}</p>}
        </div>
      )}
    </section>
  );
}
