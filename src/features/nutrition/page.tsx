import { useEffect, useState } from "react";
import { getConfig, saveConfig, type NutritionConfig } from "./api";
import { fetchHealthData } from "@features/health/api";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { ProgramsView } from "./programs";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { buildAllDataJson } from "@shared/lib/copyAllData";
import { ToastProvider } from "@shared/components/Toast";
import "./nutrition.css";

export function NutritionPage() {
  const [config, setConfig] = useState<NutritionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getConfig(), fetchHealthData(30).catch(() => null)])
      .then(([cfg, health]) => {
        const healthTdee = health?.tdee?.tdee;
        if (healthTdee != null && healthTdee !== cfg.tdee) {
          saveConfig({ tdee: healthTdee })
            .then((updated) => setConfig(updated))
            .catch(() => setConfig({ ...cfg, tdee: healthTdee }));
        } else {
          setConfig(cfg);
        }
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useCopyButton(buildAllDataJson);

  return (
    <ToastProvider>
      <div className="page">
        {error && (
          <section className="page-card">
            <p className="auth-error">{error}</p>
          </section>
        )}

        {!config && !error && (
          <section className="page-card">
            <p className="page-note">Loading…</p>
          </section>
        )}

        {config && (
          <>
            <TodayView config={config} />
            <HistoryView />
            <ProgramsView config={config} onSaved={setConfig} />
          </>
        )}
      </div>
    </ToastProvider>
  );
}
