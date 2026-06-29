import { useEffect, useState } from "react";
import { getConfig, getEntries, saveConfig, targetsFromConfig, type NutritionConfig, type NutritionEntry } from "./api";
import { fetchHealthData } from "@features/health/api";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { ProgramsView } from "./programs";
import { SegCarousel } from "@shared/components/SegCarousel";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import "./nutrition.css";

type Sub = "today" | "history" | "programs";
const TABS: { id: Sub; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "history", label: "History" },
  { id: "programs", label: "Programs" },
];

function fmtNutritionText(entries: NutritionEntry[], config: NutritionConfig | null): string {
  const targets = config ? targetsFromConfig(config) : null;
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const logged = sorted.filter((e) => e.calories != null);
  const avgCalories = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.calories ?? 0), 0) / logged.length)
    : null;
  const avgProtein = logged.length
    ? Math.round(logged.reduce((s, e) => s + (e.protein ?? 0), 0) / logged.length)
    : null;
  return JSON.stringify({
    source: "LiftOS",
    schema: 1,
    type: "nutrition",
    date: new Date().toISOString().slice(0, 10),
    targets: targets ? {
      calories: targets.calorieTarget,
      protein: targets.proteinTarget,
      tdee: config?.tdee ?? null,
    } : null,
    summary: {
      days: sorted.length,
      avgCalories,
      avgProtein,
    },
    entries: sorted.map((e) => ({
      date: e.entry_date,
      calories: e.calories,
      protein: e.protein,
    })),
  }, null, 2);
}

export function NutritionPage() {
  const [sub, setSub] = useState<Sub>("today");
  const [config, setConfig] = useState<NutritionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allEntries, setAllEntries] = useState<NutritionEntry[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    getEntries("2000-01-01", today).then(setAllEntries).catch(() => {});

    Promise.all([
      getConfig(),
      fetchHealthData(30).catch(() => null),
    ]).then(([cfg, health]) => {
      const healthTdee = health?.tdee?.tdee;
      if (healthTdee != null && healthTdee !== cfg.tdee) {
        saveConfig({ tdee: healthTdee })
          .then((updated) => setConfig(updated))
          .catch(() => setConfig({ ...cfg, tdee: healthTdee }));
      } else {
        setConfig(cfg);
      }
    }).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useCopyButton(() => fmtNutritionText(allEntries, config));

  return (
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
        <SegCarousel
          tabs={TABS}
          active={sub}
          onChange={(id) => setSub(id as Sub)}
        >
          <TodayView config={config} />
          <HistoryView />
          <ProgramsView config={config} onSaved={setConfig} />
        </SegCarousel>
      )}
    </div>
  );
}
