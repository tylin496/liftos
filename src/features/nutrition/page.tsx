import { useState } from "react";
import { useNutritionConfig } from "./NutritionConfigContext";
import { PageTopBar } from "@shared/components/PageTopBar";
import { TodayView, labelFor } from "./today";
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
  // Tapping a weekday column in the trend bar should slide the Today card
  // left/right, same as the arrow/swipe nav — this signal carries the direction
  // down; TodayView bumps its own navSeq/navDir off of it (see today.tsx).
  const [daySelectNav, setDaySelectNav] = useState<{ seq: number; dir: "forward" | "backward" } | null>(null);
  function selectDay(d: string) {
    setDaySelectNav((prev) => ({ seq: (prev?.seq ?? 0) + 1, dir: d > date ? "forward" : "backward" }));
    setDate(d);
  }

  // Header title tracks the viewed day: "Today" on today, otherwise the date
  // ("Thu, Jul 2"). The daily card no longer repeats it — the header is the
  // single place that says which day you're looking at.
  const isToday = date === defaultLogDate();
  const header = (
    <div className="shell-header">
      <PageTopBar eyebrow="NUTRITION" title={isToday ? "Today" : labelFor(date)} onCopy={copyNutritionData} />
    </div>
  );

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
        {header}
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      {/* Cold-load skeleton — real card structure with placeholder values so
          the page never sits blank under the header while config loads. */}
      {!config && (
        <>
          {/* Each skeleton card is a DIRECT .page child (not wrapped) so it joins
              the bottom-up entrance cascade instead of collapsing to one tier.
              nutri-page-skeleton stays on each card to keep scoping the shimmer. */}
          <section className="page-card daily-card loading-card nutri-page-skeleton">
            <div className="daily-card-top">
              <p className="page-eyebrow">Intake</p>
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

          <section className="page-card loading-card nutri-page-skeleton">
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

          <section className="page-card nutri-month-card loading-card nutri-page-skeleton">
            <p className="page-eyebrow" style={{ margin: 0 }}>LAST 30 DAYS</p>
            <span className="metric-val">00%</span>
            <MetricCaption>adherence</MetricCaption>
          </section>
        </>
      )}

      {config && (
        <>
          <TodayView
            config={config}
            date={date}
            onDateChange={setDate}
            daySelectNav={daySelectNav}
            onSaved={handleSaved}
            calendarOpen={calendarOpen}
            onCalendarOpenChange={setCalendarOpen}
          />
        </>
      )}

      {/* Self-contained — fetches its own state independently of config, so it
          renders OUTSIDE the config gate: during cold load its own internal
          skeleton holds the page's tail, instead of the slot being empty until
          config arrives. Sits after Today, before the History cards. */}
      <NutritionInsightCard refreshKey={entryVersion} />

      {config && (
        <HistoryView
          config={config}
          date={date}
          onDateChange={setDate}
          onSelectDay={selectDay}
          entryVersion={entryVersion}
          onOpenCalendar={() => setCalendarOpen(true)}
        />
      )}
    </div>
  );
}
