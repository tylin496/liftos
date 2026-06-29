import { useEffect, useMemo, useState } from "react";
import { getEntries, type NutritionEntry } from "./api";
import {
  formatFatLossKg,
  getCalorieResult,
  monthlyStats,
  toDateStr,
  weeklyStats,
  type DayInput,
} from "./logic";

const WEEKDAY_NARROW = ["S", "M", "T", "W", "T", "F", "S"];

function toInput(e: NutritionEntry): DayInput {
  return {
    date: e.entry_date,
    calories: e.calories,
    protein: e.protein,
    tdee: e.tdee,
    deficitTarget: e.deficit_target,
    proteinTarget: e.protein_target,
  };
}

export function HistoryView() {
  const [entries, setEntries] = useState<NutritionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const to = toDateStr(new Date());
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - 29);
    getEntries(toDateStr(fromD), to)
      .then(setEntries)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const { week, month, trend7, todayStr } = useMemo(() => {
    const todayStr = toDateStr(new Date());
    const inputs = (entries ?? []).map(toInput);

    // Build a 7-slot window: today and the 6 days before it
    const trend7: DayInput[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = toDateStr(d);
      const found = inputs.find((x) => x.date === dateStr);
      trend7.push(
        found ?? {
          date: dateStr,
          calories: null,
          protein: null,
          tdee: null,
          deficitTarget: null,
          proteinTarget: null,
        }
      );
    }

    const logged7 = trend7.filter((d) => d.calories != null);

    return {
      week: weeklyStats(logged7),
      month: monthlyStats(inputs),
      trend7,
      todayStr,
    };
  }, [entries]);

  if (error) {
    return (
      <section className="page-card">
        <p className="auth-error">{error}</p>
      </section>
    );
  }

  if (!entries) {
    return (
      <section className="page-card">
        <p className="page-note">Loading…</p>
      </section>
    );
  }

  const maxCal = Math.max(1, ...trend7.map((d) => d.calories ?? 0));

  // Adherence colour threshold
  const adherenceState =
    month.adherencePct >= 80 ? "on-plan" : month.adherencePct >= 60 ? "over" : "surplus";

  return (
    <>
      {/* ── This Week ── */}
      <section className="page-card">
        <div className="nutri-section-head">
          <p className="page-eyebrow" style={{ margin: 0 }}>This Week</p>
          {week.consistency && (
            <span className={`hist-badge badge-${week.consistency.toLowerCase()}`}>
              {week.consistency}
            </span>
          )}
        </div>

        {/* 7-day calorie trend bars */}
        <div className="nutri-trend">
          {trend7.map((d, i) => {
            const dayDate = new Date(d.date + "T12:00:00");
            const dayLabel = WEEKDAY_NARROW[dayDate.getDay()];
            const isToday = d.date === todayStr;
            const hasCal = d.calories != null;

            const calResult = hasCal
              ? getCalorieResult(
                  d.calories!,
                  d.tdee ?? undefined,
                  d.deficitTarget ?? undefined
                )
              : null;

            const barPct = hasCal
              ? Math.max(8, Math.round((d.calories! / maxCal) * 100))
              : 0;

            const barState = calResult
              ? calResult.isSurplus
                ? "surplus"
                : calResult.state
              : "missing";

            return (
              <div className="nutri-trend-col" key={d.date}>
                <div className="nutri-trend-bars">
                  {hasCal ? (
                    <div
                      className={`nutri-trend-bar is-${barState}`}
                      style={
                        {
                          height: `${barPct}%`,
                          "--bar-index": i,
                        } as React.CSSProperties
                      }
                    />
                  ) : (
                    <div className="nutri-trend-bar is-missing" />
                  )}
                </div>
                <span className={`nutri-trend-day${isToday ? " is-today" : ""}`}>
                  {dayLabel}
                </span>
              </div>
            );
          })}
        </div>

        {/* KPI row */}
        <div className="nutri-kpi-row">
          <div className="nutri-kpi">
            <span className="nutri-kpi-val">
              {week.avgCalories > 0 ? week.avgCalories.toLocaleString() : "—"}
              {week.avgCalories > 0 && <small>kcal</small>}
            </span>
            <span className="nutri-kpi-label">Avg Cal</span>
          </div>
          <div className="nutri-kpi">
            <span className="nutri-kpi-val">
              {week.avgProtein > 0 ? week.avgProtein : "—"}
              {week.avgProtein > 0 && <small>g</small>}
            </span>
            <span className="nutri-kpi-label">Avg Protein</span>
          </div>
          <div className="nutri-kpi">
            <span className="nutri-kpi-val">
              {formatFatLossKg(week.fatLossKg)}
              <small>kg</small>
            </span>
            <span className="nutri-kpi-label">Est. Fat Loss</span>
          </div>
        </div>
      </section>

      {/* ── Last 30 Days ── */}
      <section className="page-card">
        <div className="nutri-section-head">
          <p className="page-eyebrow" style={{ margin: 0 }}>Last 30 Days</p>
          <span className="nutri-month-count">{month.logged} logged</span>
        </div>

        {/* Adherence hero */}
        <div className="nutri-adherence-hero">
          <span className={`nutri-adherence-num state-${adherenceState}`}>
            {month.adherencePct}
          </span>
          <div className="nutri-adherence-info">
            <span className="nutri-adherence-pct">%</span>
            <span className="nutri-adherence-sub">on plan</span>
          </div>
        </div>

        {/* Distribution bar */}
        <div className="hist-dist">
          {(["surplus", "under", "on-plan", "over", "extreme"] as const).map((s) => (
            <div
              key={s}
              className={`hist-dist-seg state-${s}`}
              style={{ flexGrow: month.distribution[s] || 0 }}
              title={`${s}: ${month.distribution[s]}`}
            />
          ))}
        </div>

        {/* Stats grid */}
        <div className="hist-stats" style={{ marginTop: "var(--space-4)" }}>
          <div>
            <span className="health-k">On-plan days</span>
            <span className="health-v">{month.onPlan}</span>
          </div>
          <div>
            <span className="health-k">Double-hit</span>
            <span className="health-v">{month.doubleHitPct}%</span>
          </div>
          <div>
            <span className="health-k">Current streak</span>
            <span className="health-v">{month.currentStreak}d</span>
          </div>
          <div>
            <span className="health-k">Days logged</span>
            <span className="health-v">{month.logged}</span>
          </div>
        </div>
      </section>
    </>
  );
}
