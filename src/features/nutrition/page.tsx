import { useState } from "react";
import { useNutritionConfig } from "./NutritionConfigContext";
import { PageTopBar } from "@shared/components/PageTopBar";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { defaultLogDate } from "./logic";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import "./nutrition.css";

export function NutritionPage() {
  const { config } = useNutritionConfig();
  const [date, setDate] = useState(defaultLogDate());
  const [entryVersion, setEntryVersion] = useState(0);


  return (
    <div className="page">
      <PageTopBar
        eyebrow="NUTRITION"
        title="Today"
        onCopy={() => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS)}
      />

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
        </>
      )}
    </div>
  );
}
