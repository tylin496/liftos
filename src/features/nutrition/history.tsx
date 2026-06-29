import { useEffect, useMemo, useState } from "react";
import { getEntries, type NutritionEntry } from "./api";
import {
  formatFatLossKg,
  monthlyStats,
  toDateStr,
  weeklyStats,
  type DayInput,
} from "./logic";

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

  const { week, month, trend } = useMemo(() => {
    const inputs = (entries ?? []).map(toInput);
    const last7 = inputs.slice(-7);
    return {
      week: weeklyStats(last7),
      month: monthlyStats(inputs),
      trend: last7,
    };
  }, [entries]);

  if (error) return <div className="nutri"><section className="page-card"><p className="auth-error">{error}</p></section></div>;
  if (!entries) return <div className="nutri"><section className="page-card"><p className="page-note">Loading…</p></section></div>;

  const maxNet = Math.max(
    1,
    ...trend.map((d) => Math.abs((d.tdee ?? 0) - (d.calories ?? d.tdee ?? 0))),
  );

  return (
    <div className="nutri">
      {/* Weekly */}
      <section className="page-card">
        <div className="hist-head">
          <p className="page-eyebrow">This week · {week.logged} logged</p>
          {week.consistency && (
            <span className={`hist-badge badge-${week.consistency.toLowerCase()}`}>
              {week.consistency}
            </span>
          )}
        </div>
        <div className="hist-stats">
          <div>
            <span className="health-k">Avg calories</span>
            <span className="health-v">{week.avgCalories.toLocaleString()}</span>
          </div>
          <div>
            <span className="health-k">Avg protein</span>
            <span className="health-v">{week.avgProtein} g</span>
          </div>
          <div>
            <span className="health-k">Total deficit</span>
            <span className="health-v">{week.totalDeficit.toLocaleString()}</span>
          </div>
          <div>
            <span className="health-k">Est. fat loss</span>
            <span className="health-v">{formatFatLossKg(week.fatLossKg)} kg</span>
          </div>
        </div>
        <div className="hist-trend">
          {trend.map((d) => {
            const net = (d.tdee ?? 0) - (d.calories ?? d.tdee ?? 0);
            const h = Math.round((Math.abs(net) / maxNet) * 100);
            return (
              <div className="hist-bar-col" key={d.date} title={`${d.date}: ${net} kcal`}>
                <div
                  className={`hist-bar ${net >= 0 ? "is-deficit" : "is-surplus"}`}
                  style={{ height: `${Math.max(4, h)}%` }}
                />
                <span className="hist-bar-day">
                  {new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
                    weekday: "narrow",
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Monthly */}
      <section className="page-card">
        <p className="page-eyebrow">Last 30 days · {month.logged} logged</p>
        <div className="hist-stats">
          <div>
            <span className="health-k">On-plan</span>
            <span className="health-v">{month.adherencePct}%</span>
          </div>
          <div>
            <span className="health-k">Double-hit</span>
            <span className="health-v">{month.doubleHitPct}%</span>
          </div>
          <div>
            <span className="health-k">Current streak</span>
            <span className="health-v">{month.currentStreak} d</span>
          </div>
          <div>
            <span className="health-k">On-plan days</span>
            <span className="health-v">{month.onPlan}</span>
          </div>
        </div>
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
      </section>

    </div>
  );
}
