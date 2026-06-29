import { useEffect, useState } from "react";
import { getConfig, saveConfig, type NutritionConfig } from "./api";
import { fetchHealthData } from "@features/health/api";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { ProgramsView } from "./programs";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { buildAllDataJson } from "@shared/lib/copyAllData";
import { ToastProvider } from "@shared/components/Toast";
import { defaultLogDate } from "./logic";
import "./nutrition.css";

export function NutritionPage() {
  const [config, setConfig] = useState<NutritionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(defaultLogDate());
  const [entryVersion, setEntryVersion] = useState(0);
  const activity = useTabActivity();

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
  }, [activity]);

  useCopyButton(buildAllDataJson);

  return (
    <ToastProvider>
      <div className="page">
        {error && (
          <section className="page-card">
            <p className="auth-error">{error}</p>
          </section>
        )}

        {config && (
          <>
            <TodayView
              config={config}
              date={date}
              onDateChange={setDate}
              onSaved={() => setEntryVersion((v) => v + 1)}
            />
            <HistoryView
              config={config}
              date={date}
              onDateChange={setDate}
              entryVersion={entryVersion}
            />
            <ProgramsView config={config} onSaved={setConfig} />
          </>
        )}
      </div>
    </ToastProvider>
  );
}
