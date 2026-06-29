import { useEffect, useState } from "react";
import { getConfig, saveConfig, type NutritionConfig } from "./api";
import { fetchHealthData } from "@features/health/api";
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
          <>
            <section className="page-card loading-card">
              <p className="page-eyebrow">TODAY</p>
              <div className="nutri-skel-hero">
                <span className="nutri-skel-num">1,234</span>
                <span className="nutri-skel-unit">kcal</span>
              </div>
              <div className="nutri-skel-bar" />
              <div className="nutri-skel-hero nutri-skel-hero--sm">
                <span className="nutri-skel-num">000</span>
                <span className="nutri-skel-unit">g protein</span>
              </div>
              <div className="nutri-skel-bar" />
            </section>
            <section className="page-card loading-card" style={{ height: 140 }} />
            <section className="page-card loading-card" style={{ height: 80 }} />
          </>
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
