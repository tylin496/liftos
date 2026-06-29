import { useEffect, useMemo, useState } from "react";
import { getEntries, type NutritionEntry } from "./api";
import {
  formatFatLossKg,
  monthlyStats,
  phaseFromDeficit,
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

function fmtDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function buildCopyText(entries: NutritionEntry[]): string {
  if (!entries.length) return "(no entries)";

  // Group into contiguous spans by phase name
  type Span = { phase: string; rows: NutritionEntry[] };
  const spans: Span[] = [];

  for (const e of entries) {
    const deficit = e.deficit_target ?? 500;
    const phase = phaseFromDeficit(deficit);
    const last = spans[spans.length - 1];
    if (last && last.phase === phase) {
      last.rows.push(e);
    } else {
      spans.push({ phase, rows: [e] });
    }
  }

  return spans
    .map(({ phase, rows }) => {
      const header = `=== ${phase}  ${fmtDate(rows[0].entry_date)} – ${fmtDate(rows[rows.length - 1].entry_date)} ===`;
      const lines = rows.map((e) => {
        const cal = e.calories ?? "—";
        const prot = e.protein != null ? `  ${e.protein}g` : "";
        const net = e.tdee != null && e.calories != null ? e.tdee - e.calories : null;
        const netStr = net != null ? `  ${net >= 0 ? "−" : "+"}${Math.abs(net)}` : "";
        return `${e.entry_date}  ${cal} kcal${netStr}${prot}`;
      });
      return [header, ...lines].join("\n");
    })
    .join("\n\n");
}

export function HistoryView() {
  const [entries, setEntries] = useState<NutritionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allEntries, setAllEntries] = useState<NutritionEntry[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const to = toDateStr(new Date());
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - 29);
    getEntries(toDateStr(fromD), to)
      .then(setEntries)
      .catch((e) => setError(String(e?.message ?? e)));
    // Also fetch all entries for Copy All
    getEntries("2000-01-01", to)
      .then(setAllEntries)
      .catch(() => {});
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

  async function handleCopyAll() {
    const text = buildCopyText(allEntries ?? []);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

      {/* Copy All */}
      <section className="page-card nutri-form">
        <button className="nutri-save" onClick={handleCopyAll}>
          {copied ? "Copied ✓" : "Copy all entries"}
        </button>
        <p className="page-note">按 phase 分組，複製全部紀錄</p>
      </section>
    </div>
  );
}
