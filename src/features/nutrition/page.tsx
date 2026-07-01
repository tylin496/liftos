import { useState } from "react";
import { useNutritionConfig } from "./NutritionConfigContext";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { NutritionInsightCard } from "./NutritionInsightCard";
import { recomputeAndPersist } from "./evaluationApi";
import { defaultLogDate } from "./logic";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import "./nutrition.css";

const copyAllData = () => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS);

export function NutritionPage() {
  const { config } = useNutritionConfig();
  const [date, setDate] = useState(defaultLogDate());
  const [entryVersion, setEntryVersion] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);

  usePageHeader({ eyebrow: "NUTRITION", title: "Today", onCopy: copyAllData });

  // New data landed → refresh the day/history immediately, then recompute the
  // shared evaluation in the background and bump again so the Insight card picks
  // up the fresh state. Fire-and-forget: never blocks the save toast.
  function handleSaved() {
    setEntryVersion((v) => v + 1);
    void recomputeAndPersist()
      .then(() => setEntryVersion((v) => v + 1))
      .catch(() => {});
  }

  return (
    <div className="page">
      {config && (
        <>
          <TodayView
            config={config}
            date={date}
            onDateChange={setDate}
            onSaved={handleSaved}
            calendarOpen={calendarOpen}
            onCalendarOpenChange={setCalendarOpen}
          />
          <HistoryView
            config={config}
            date={date}
            onDateChange={setDate}
            entryVersion={entryVersion}
            onOpenCalendar={() => setCalendarOpen(true)}
          />
          <NutritionInsightCard refreshKey={entryVersion} />
        </>
      )}
    </div>
  );
}
