import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useToast } from "@shared/components/Toast";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
import { saveConfig, targetsFromConfig, phaseDefsFromConfig } from "@features/nutrition/api";
import { phaseFromDeficit, trainingMonthsFromStart } from "@features/nutrition/logic";

function SheetInner({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { config, setConfig } = useNutritionConfig();
  const toast = useToast();

  const [protein, setProtein] = useState("");
  const [currentIntake, setCurrentIntake] = useState("");
  const [height, setHeight] = useState("");
  const [trainingStartDate, setTrainingStartDate] = useState("");
  const [targetBf, setTargetBf] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    const t = targetsFromConfig(config);
    setProtein(String(config.protein_target));
    setCurrentIntake(String(t.calorieTarget));
    setHeight(config.height_cm == null ? "" : String(config.height_cm));
    setTrainingStartDate(config.training_start_date ?? "");
    setTargetBf(config.target_body_fat_pct == null ? "" : String(config.target_body_fat_pct));
  }, [config]);

  const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  const liveTrainingMonths = trainingMonthsFromStart(trainingStartDate);
  const intake = Math.max(0, Number(currentIntake) || 0);
  const liveDeficit = Math.max(0, Math.round((config?.tdee ?? 0) - intake));
  const livePhaseName = phaseFromDeficit(liveDeficit);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const { defs: savedDefs } = phaseDefsFromConfig(config);
      const updated = await saveConfig({
        protein_target: Math.round(Number(protein) || config.protein_target),
        phase_deficits: [...savedDefs, intake] as unknown as any,
        height_cm: numOrNull(height),
        training_start_date: trainingStartDate || null,
        target_body_fat_pct: numOrNull(targetBf),
      });
      setConfig(updated);
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
        className={`settings-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Settings"
      >
        <div className="settings-sheet-header">
          <span className="settings-sheet-title">Settings</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body">
          <p className="settings-section-label">Nutrition</p>

          <label className="nutri-field">
            <span>Protein target (g)</span>
            <input type="number" inputMode="numeric" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>

          <label className="nutri-field">
            <span>Intake goal (kcal/day)</span>
            <input type="number" inputMode="numeric" value={currentIntake} onChange={(e) => setCurrentIntake(e.target.value)} />
          </label>

          <div className="prog-auto-phase">
            <span className="prog-auto-label">Phase</span>
            <span className="prog-auto-val">{livePhaseName}</span>
            <span className="prog-auto-deficit">−{liveDeficit.toLocaleString()} kcal deficit</span>
          </div>

          <p className="settings-section-label" style={{ marginTop: "var(--space-4)" }}>Profile</p>

          <label className="nutri-field">
            <span>Height (cm)</span>
            <input type="number" inputMode="decimal" placeholder="—" value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>

          <label className="nutri-field">
            <span>Training start date</span>
            <input type="date" value={trainingStartDate} onChange={(e) => setTrainingStartDate(e.target.value)} />
          </label>
          {liveTrainingMonths !== null && (
            <p className="nutri-training-age-hint">= {liveTrainingMonths} months of training</p>
          )}

          <label className="nutri-field">
            <span>Target body fat (%)</span>
            <input type="number" inputMode="decimal" placeholder="—" value={targetBf} onChange={(e) => setTargetBf(e.target.value)} />
          </label>

          <button className="nutri-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>

          {error && <p className="auth-error">{error}</p>}
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
