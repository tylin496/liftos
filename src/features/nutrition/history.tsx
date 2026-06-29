import { useEffect, useMemo, useState } from "react";
import { getEntries, targetsFromConfig, type NutritionConfig, type NutritionEntry } from "./api";
import {
  formatFatLossKg,
  getCalorieResult,
  getProteinResult,
  monthlyStats,
  toDateStr,
  weeklyStats,
  type DayInput,
} from "./logic";

const WEEKDAY_NARROW = ["S", "M", "T", "W", "T", "F", "S"];

function haptic(kind: "tap" | "select" = "tap") {
  if (!navigator.vibrate) return;
  navigator.vibrate(kind === "select" ? 12 : 8);
}

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

export function HistoryView({
  config,
  date,
  onDateChange,
  entryVersion,
}: {
  config: NutritionConfig;
  date: string;
  onDateChange: (date: string) => void;
  entryVersion: number;
}) {
  const [entries, setEntries] = useState<NutritionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const defaultTargets = useMemo(() => targetsFromConfig(config), [config]);

  useEffect(() => {
    const to = toDateStr(new Date());
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - 29);
    getEntries(toDateStr(fromD), to)
      .then(setEntries)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [entryVersion]);

  const { week, month, trend7, todayStr } = useMemo(() => {
    const todayStr = toDateStr(new Date());
    const inputs = (entries ?? []).map(toInput);

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
        },
      );
    }

    const logged7 = trend7.filter((d) => d.calories != null);
    return { week: weeklyStats(logged7), month: monthlyStats(inputs), trend7, todayStr };
  }, [entries]);

  async function handleCopyWeek() {
    haptic("tap");
    const logged = trend7.filter((d) => d.calories != null);
    if (logged.length === 0) return;
    const lines = [
      `Week (${trend7[0].date} → ${trend7[6].date}):`,
      `Avg cal: ${week.avgCalories.toLocaleString()} kcal · Avg protein: ${week.avgProtein}g`,
      ...logged.map((d) => {
        const dateLabel = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        });
        return `  ${dateLabel}: ${d.calories?.toLocaleString()} kcal, ${d.protein}g`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      /* ignore */
    }
  }

  if (error) {
    return (
      <section className="page-card">
        <p className="auth-error">{error}</p>
      </section>
    );
  }

  if (!entries) {
    return (
      <>
        <section className="page-card loading-card">
          <p className="page-eyebrow">THIS WEEK</p>
          <div className="nutri-skel-week-bars">
            {["M","T","W","T","F","S","S"].map((d, i) => (
              <div key={i} className="nutri-skel-week-col">
                <div className="nutri-skel-bar-vert" style={{ height: `${30 + Math.abs((i - 3) * 8)}%` }} />
                <span className="nutri-skel-day">{d}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="page-card loading-card" style={{ height: 120 }} />
      </>
    );
  }

  const adherenceState =
    month.adherencePct >= 80 ? "on-plan" : month.adherencePct >= 60 ? "over" : "surplus";

  return (
    <>
      {/* ── This Week ── */}
      <section className="page-card">
        <div className="nutri-section-head">
          <p className="page-eyebrow" style={{ margin: 0 }}>This Week</p>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {week.consistency && (
              <span className={`hist-badge badge-${week.consistency.toLowerCase()}`}>
                {week.consistency}
              </span>
            )}
            {week.logged > 0 && (
              <button
                className="hist-copy-btn"
                type="button"
                aria-label="Copy week summary"
                onClick={handleCopyWeek}
              >
                {copyState === "copied" ? "✓" : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Dual-bar 7-day trend */}
        <div className="nutri-trend">
          {trend7.map((d, i) => {
            const dayDate = new Date(d.date + "T12:00:00");
            const dayLabel = WEEKDAY_NARROW[dayDate.getDay()];
            const isToday = d.date === todayStr;
            const isSelected = d.date === date;
            const hasCal = d.calories != null;
            const hasProtein = d.protein != null;

            const calTarget = d.tdee != null && d.deficitTarget != null
              ? Math.max(1, d.tdee - d.deficitTarget)
              : defaultTargets.calorieTarget;
            const protTarget = d.proteinTarget ?? defaultTargets.proteinTarget;

            const calResult = hasCal
              ? getCalorieResult(d.calories!, d.tdee ?? undefined, d.deficitTarget ?? undefined)
              : null;
            const protResult = hasProtein
              ? getProteinResult(d.protein!, d.proteinTarget ?? undefined)
              : null;

            const kcalPct = hasCal
              ? Math.max(7, Math.round(Math.min(100, (d.calories! / Math.max(1, calTarget)) * 100)))
              : 0;
            const protPct = hasProtein
              ? Math.max(7, Math.round(Math.min(100, (d.protein! / Math.max(1, protTarget)) * 100)))
              : 0;

            const isSurplus = calResult?.isSurplus ?? false;
            const doubleHit = calResult?.state === "on-plan" && protResult?.celebrated;

            return (
              <button
                key={d.date}
                className={[
                  "nutri-trend-col",
                  isSelected ? "is-selected" : "",
                  isToday ? "is-today-col" : "",
                  !hasCal ? "is-missing" : "",
                  doubleHit ? "is-double-hit" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                aria-label={`${d.date}${hasCal ? `: ${d.calories?.toLocaleString()} kcal, ${d.protein}g` : ": no entry"}`}
                onClick={() => { haptic("select"); onDateChange(d.date); }}
              >
                {/* Value labels */}
                <div className="ntb-values">
                  {hasCal && (
                    <>
                      <span className="ntb-val-kcal">{d.calories?.toLocaleString()}</span>
                      {hasProtein && <span className="ntb-val-prot">{d.protein}g</span>}
                    </>
                  )}
                </div>

                {/* Bars */}
                <div className="nutri-trend-bars">
                  {hasCal || hasProtein ? (
                    <div className="ntb-pair" style={{ "--bar-index": i } as React.CSSProperties}>
                      <div
                        className={`ntb-bar ntb-bar-kcal${isSurplus ? " surplus" : ""}`}
                        style={{ height: hasCal ? `${kcalPct}%` : "7px" }}
                      />
                      <div
                        className={`ntb-bar ntb-bar-prot${doubleHit ? " celebrated" : ""}`}
                        style={{ height: hasProtein ? `${protPct}%` : "7px" }}
                      />
                    </div>
                  ) : (
                    <div className="ntb-pair ntb-pair--missing" style={{ "--bar-index": i } as React.CSSProperties}>
                      <div className="ntb-bar ntb-bar--missing" />
                      <div className="ntb-bar ntb-bar--missing" />
                    </div>
                  )}
                </div>

                <span className={`nutri-trend-day${isToday ? " is-today" : ""}`}>
                  {dayLabel}
                </span>
              </button>
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

        <div className="nutri-adherence-hero">
          <span className={`nutri-adherence-num state-${adherenceState}`}>
            {month.adherencePct}
          </span>
          <div className="nutri-adherence-info">
            <span className="nutri-adherence-pct">%</span>
            <span className="nutri-adherence-sub">on plan</span>
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
