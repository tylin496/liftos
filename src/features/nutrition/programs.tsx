import { useEffect, useState } from "react";
import {
  saveConfig,
  targetsFromConfig,
  phaseDefsFromConfig,
  PHASE_NAMES,
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
  const [phaseDefs, setPhaseDefs] = useState<number[]>(savedDefs);
  const [currentIntake, setCurrentIntake] = useState(String(targets.calorieTarget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { defs } = phaseDefsFromConfig(config);
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setPhaseDefs(defs);
    setCurrentIntake(String(t.calorieTarget));
  }, [config]);

  const intake = Math.max(0, Number(currentIntake) || 0);
  const liveDeficit = Math.max(0, Math.round(config.tdee - intake));
  const livePhaseName = phaseFromDeficit(liveDeficit);

  // Closest phase preset index for highlighting
  const activePresetIndex = phaseDefs.reduce(
    (best, def, i) =>
      Math.abs(def - liveDeficit) < Math.abs(phaseDefs[best] - liveDeficit) ? i : best,
    0,
  );

  function updatePhaseIntake(index: number, value: string) {
    const phaseIntake = Math.max(0, Number(value) || 0);
    const deficit = Math.max(0, Math.round(config.tdee - phaseIntake));
    setPhaseDefs((prev) => {
      const next = [...prev];
      next[index] = deficit;
      return next;
    });
  }

  async function handleSaveEdits() {
    setSaving(true);
    setError(null);
    try {
      // Derive closest activeIndex so legacy targetsFromConfig fallback still works
      // Store [p0, p1, p2, p3, intake] — targetsFromConfig reads intake (≥100) from index 4
      const newPhaseDeficits = [...phaseDefs, intake] as unknown as number[];
      const updated = await saveConfig({
        protein_target: Math.round(Number(protein) || config.protein_target),
        phase_deficits: newPhaseDeficits as any,
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
      <div className="nutri-section-head">
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

          {/* Live phase preview */}
          <div className="prog-auto-phase">
            <span className="prog-auto-label">Phase</span>
            <span className="prog-auto-val">{livePhaseName}</span>
            <span className="prog-auto-deficit">−{liveDeficit.toLocaleString()} kcal deficit</span>
          </div>

          {/* Presets */}
          <div className="prog-phases-heading">Presets</div>
          <div className="prog-phases">
            {PHASE_NAMES.map((name, i) => {
              const calTarget = Math.max(0, Math.round(config.tdee - phaseDefs[i]));
              const isClosest = i === activePresetIndex && phaseDefs[i] === liveDeficit;
              return (
                <div
                  key={name}
                  className={`prog-phase${isClosest ? " is-active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setCurrentIntake(String(calTarget))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCurrentIntake(String(calTarget)); }}
                >
                  <div className="prog-phase-main">
                    <span className="prog-phase-name">{name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={calTarget}
                      className="prog-intake-input"
                      aria-label={`${name} intake`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updatePhaseIntake(i, e.target.value);
                      }}
                    />
                    <span className="prog-phase-target-unit">kcal/day</span>
                  </div>
                  <div className="prog-deficit">
                    <span className="prog-deficit-label">deficit</span>
                    <span className="prog-deficit-val">{phaseDefs[i]}</span>
                  </div>
                </div>
              );
            })}
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
