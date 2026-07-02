import { useState } from "react";
import { useNutritionConfig } from "./NutritionConfigContext";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { TodayView } from "./today";
import { HistoryView } from "./history";
import { NutritionInsightCard } from "./NutritionInsightCard";
import { recomputeAndPersist } from "./evaluationApi";
import { defaultLogDate } from "./logic";
import { buildNutritionJson } from "@shared/lib/copyAllData";
import { MetricCaption } from "@shared/components/Metric";
import { ErrorState } from "@shared/components/ErrorState";
import "./nutrition.css";
import "@shared/components/nutriGrid.css";

const copyNutritionData = () => buildNutritionJson();

export function NutritionPage() {
  const { config, error, reload } = useNutritionConfig();
  const [date, setDate] = useState(defaultLogDate());
  const [entryVersion, setEntryVersion] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);

  usePageHeader({ eyebrow: "NUTRITION", title: "Today", onCopy: copyNutritionData });

  // New data landed → refresh the day/history immediately, then recompute the
  // shared evaluation in the background and bump again so the Insight card picks
  // up the fresh state. Fire-and-forget: never blocks the save toast.
  function handleSaved() {
    setEntryVersion((v) => v + 1);
    void recomputeAndPersist()
      .then(() => setEntryVersion((v) => v + 1))
      .catch(() => {});
  }

  if (error && !config) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="page">
      {/* Cold-load skeleton — real card structure with placeholder values so
          the page never sits blank under the header while config loads. */}
      {!config && (
        <div className="nutri-page-skeleton">
          <section className="page-card daily-card loading-card">
            <div className="daily-card-top">
              <span className="daily-card-heading">TODAY · NUTRITION</span>
            </div>
            <div className="nutri-grid">
              <div className="nutri-col">
                <span className="nutri-label">Calories</span>
                <span className="metric-val metric-val--lg">0,000</span>
                <MetricCaption>of 0,000 kcal</MetricCaption>
              </div>
              <div className="nutri-col">
                <span className="nutri-label">Protein</span>
                <span className="metric-val metric-val--lg">000</span>
                <MetricCaption>of 000g</MetricCaption>
              </div>
            </div>
          </section>

          <section className="page-card loading-card">
            <p className="page-eyebrow" style={{ margin: 0 }}>THIS WEEK</p>
            <div className="nutri-kpi-row">
              <div className="nutri-kpi">
                <span className="metric-val">0,000</span>
                <MetricCaption>kcal avg</MetricCaption>
              </div>
              <div className="nutri-kpi">
                <span className="metric-val">000</span>
                <MetricCaption>g avg</MetricCaption>
              </div>
            </div>
          </section>

          <section className="page-card nutri-month-card loading-card">
            <p className="page-eyebrow" style={{ margin: 0 }}>LAST 30 DAYS</p>
            <span className="metric-val">00%</span>
            <MetricCaption>adherence</MetricCaption>
          </section>
        </div>
      )}

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
        </>
      )}

      {/* Self-contained — fetches its own state independently of config, so
          it doesn't need to wait behind the gate above. */}
      <NutritionInsightCard refreshKey={entryVersion} />
    </div>
  );
}
