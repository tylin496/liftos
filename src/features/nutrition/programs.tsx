import { useEffect, useState } from "react";
import {
  saveConfig,
  targetsFromConfig,
  phaseDefsFromConfig,
  PHASE_NAMES,
  type NutritionConfig,
} from "./api";
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
  const { defs: savedDefs, activeIndex: savedActiveIndex } = phaseDefsFromConfig(config);

  const [editing, setEditing] = useState(false);
  const [protein, setProtein] = useState(String(config.protein_target));
  const [phaseDefs, setPhaseDefs] = useState<number[]>(savedDefs);
  const [activeIndex, setActiveIndex] = useState(savedActiveIndex);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { defs, activeIndex: ai } = phaseDefsFromConfig(config);
    setProtein(String(config.protein_target));
    setPhaseDefs(defs);
    setActiveIndex(ai);
  }, [config]);

  function updatePhaseIntake(index: number, value: string) {
    const intake = Math.max(0, Number(value) || 0);
    const deficit = Math.max(0, Math.round(config.tdee - intake));
    setPhaseDefs((prev) => {
      const next = [...prev];
      next[index] = deficit;
      return next;
    });
  }

  async function activatePhase(index: number) {
    setSavingIndex(index);
    setError(null);
    try {
      const newPhaseDeficits = [...phaseDefs, index] as unknown as number[];
      const updated = await saveConfig({
        protein_target: Math.round(Number(protein) || config.protein_target),
        phase_deficits: newPhaseDeficits as any,
      });
      onSaved(updated);
      setActiveIndex(index);
      toast(`${PHASE_NAMES[index]} activated`, "success");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSavingIndex(null);
    }
  }

  async function handleSaveEdits() {
    setSaving(true);
    setError(null);
    try {
      const newPhaseDeficits = [...phaseDefs, activeIndex] as unknown as number[];
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

  const activeCalTarget = Math.max(0, Math.round(config.tdee - phaseDefs[activeIndex]));

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
          <span className="nutri-prog-val">{activeCalTarget.toLocaleString()}</span>
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
          <span className="nutri-prog-val is-text">{PHASE_NAMES[activeIndex]}</span>
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

          {/* 4 Cut Phases */}
          <div className="prog-phases-heading">Cut phases</div>
          <div className="prog-phases">
            {PHASE_NAMES.map((name, i) => {
              const isActive = i === activeIndex;
              const calTarget = Math.max(0, Math.round(config.tdee - phaseDefs[i]));
              const isSaving = savingIndex === i;
              return (
                <div key={name} className={`prog-phase${isActive ? " is-active" : ""}`}>
                  <div className="prog-phase-main">
                    <span className="prog-phase-name">{name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={calTarget}
                      onChange={(e) => updatePhaseIntake(i, e.target.value)}
                      aria-label={`${name} intake goal`}
                      className="prog-intake-input"
                    />
                    <span className="prog-phase-target-unit">kcal/day</span>
                  </div>
                  <div className="prog-deficit">
                    <span className="prog-deficit-label">deficit</span>
                    <span className="prog-deficit-val">{phaseDefs[i]}</span>
                  </div>
                  {!isActive && (
                    <button
                      className="prog-activate-btn"
                      type="button"
                      onClick={() => activatePhase(i)}
                      disabled={isSaving || saving}
                    >
                      {isSaving ? "…" : "Activate"}
                    </button>
                  )}
                  {isActive && (
                    <span className="prog-active-badge">Active</span>
                  )}
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
