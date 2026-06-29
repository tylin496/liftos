import { useEffect, useState } from "react";
import { fetchOverview, type OverviewData, type StrengthSummary } from "./api";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import "./overview.css";

const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function fmtDate(): string {
  const d = new Date();
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function pct(val: number, target: number): number {
  if (!target) return 0;
  return Math.min(100, Math.round((val / target) * 100));
}

function fmtWeightDelta(latest: number | null, weekAgo: number | null): {
  text: string;
  cls: string;
} {
  if (latest == null || weekAgo == null) return { text: "—", cls: "empty" };
  const d = parseFloat((latest - weekAgo).toFixed(1));
  if (d === 0) return { text: "±0 kg", cls: "" };
  const sign = d > 0 ? "+" : "";
  return {
    text: `${sign}${d} kg`,
    cls: d > 0 ? "bad" : "good",
  };
}

interface NutritionCardProps {
  data: OverviewData;
}

function NutritionCard({ data }: NutritionCardProps) {
  const { today, nutritionTargets } = data;

  if (!today && !nutritionTargets) {
    return (
      <section className="page-card ov-nutrition">
        <p className="ov-card-eyebrow">Today</p>
        <p className="ov-no-entry">No entry yet — log your first meal in Nutrition.</p>
      </section>
    );
  }

  const kcal = today?.calories ?? 0;
  const protein = today?.protein ?? 0;
  const kcalTarget = nutritionTargets?.calorieTarget ?? 0;
  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;

  const kcalPct = pct(kcal, kcalTarget);
  const proteinPct = pct(protein, proteinTarget);

  return (
    <section className="page-card ov-nutrition">
      <p className="ov-card-eyebrow">Today · {fmtDate()}</p>

      <div className="ov-nutrition-row">
        <div className="ov-nutrition-head">
          <span className="ov-nutrition-label">Calories</span>
          <span className="ov-nutrition-val">
            {kcal.toLocaleString()}
            {kcalTarget > 0 && (
              <span className="ov-nutrition-target"> / {kcalTarget.toLocaleString()} kcal</span>
            )}
          </span>
        </div>
        {kcalTarget > 0 && (
          <div className="ov-bar-track">
            <div
              className={`ov-bar-fill${kcalPct >= 100 ? " over" : ""}`}
              style={{ width: `${kcalPct}%` }}
            />
          </div>
        )}
      </div>

      <div className="ov-nutrition-row">
        <div className="ov-nutrition-head">
          <span className="ov-nutrition-label">Protein</span>
          <span className="ov-nutrition-val">
            {protein}
            {proteinTarget > 0 && (
              <span className="ov-nutrition-target"> / {proteinTarget} g</span>
            )}
          </span>
        </div>
        {proteinTarget > 0 && (
          <div className="ov-bar-track">
            <div
              className={`ov-bar-fill protein${proteinPct >= 100 ? " over" : ""}`}
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function StrengthCard({ s }: { s: StrengthSummary }) {
  if (s.total === 0) {
    return (
      <section className="page-card ov-strength">
        <p className="ov-card-eyebrow">Performance Trend</p>
        <p className="ov-no-entry">Log at least 4 sessions per exercise to see trends.</p>
      </section>
    );
  }

  const dominant =
    s.improving >= s.stable && s.improving >= s.watch
      ? "Improving"
      : s.watch > s.stable
        ? "Watch"
        : "Stable";
  const dominantCls = dominant === "Improving" ? "good" : dominant === "Watch" ? "bad" : "";
  const watchList = s.exercises.filter((e) => e.status === "watch");

  return (
    <section className="page-card ov-strength">
      <p className="ov-card-eyebrow">Performance Trend · last 3 sessions</p>
      <div className="ov-strength-top">
        <span className={`ov-strength-label${dominantCls ? ` ov-strength-${dominantCls}` : ""}`}>
          {dominant}
        </span>
        <span className="ov-strength-of">{s.total} exercises tracked</span>
      </div>
      <div className="ov-strength-row">
        {s.improving > 0 && (
          <span className="ov-strength-pill ov-strength-pill-good">↑ {s.improving} improving</span>
        )}
        {s.stable > 0 && (
          <span className="ov-strength-pill ov-strength-pill-stable">→ {s.stable} stable</span>
        )}
        {s.watch > 0 && (
          <span className="ov-strength-pill ov-strength-pill-watch">↓ {s.watch} watch</span>
        )}
      </div>
      {watchList.length > 0 && (
        <>
          <p className="ov-strength-attention-label">Needs attention</p>
          <ul className="ov-strength-detail">
            {watchList.map((e) => (
              <li key={e.slug}>{e.name}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useCopyButton(() => {
    if (!data) return "";
    const t = data.today;
    const s = data.strength;
    return JSON.stringify({
      source: "LiftOS",
      type: "overview",
      date: new Date().toISOString().slice(0, 10),
      today: {
        calories: t?.calories ?? null,
        protein: t?.protein ?? null,
      },
      weight: {
        latest: data.weightLatest,
        change7d: data.weightLatest != null && data.weightWeekAgo != null
          ? +((data.weightLatest - data.weightWeekAgo).toFixed(2))
          : null,
      },
      tdee: data.tdee != null ? Math.round(data.tdee) : null,
      training: {
        sessions: data.sessionsThisWeek,
        prs: data.prThisMonth,
        trend: {
          improving: s.improving,
          stable: s.stable,
          watch: s.watch,
        },
      },
    }, null, 2);
  });

  if (error) {
    return (
      <div className="page">
        <section className="page-card">
          <p className="auth-error">{error}</p>
        </section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <section className="page-card">
          <p className="page-note">Loading…</p>
        </section>
      </div>
    );
  }

  const weightDelta = fmtWeightDelta(data.weightLatest, data.weightWeekAgo);

  return (
    <div className="page">
      <NutritionCard data={data} />

      <div className="ov-grid-2">
        <div className="ov-stat">
          <span className="ov-stat-label">Weight</span>
          <span className={`ov-stat-val ${weightDelta.cls}`}>{weightDelta.text}</span>
          <span className="ov-stat-sub">vs 7 days ago</span>
        </div>

        <div className="ov-stat">
          <span className="ov-stat-label">TDEE</span>
          {data.tdee != null ? (
            <>
              <span className="ov-stat-val">{data.tdee.toLocaleString()}</span>
              <span className="ov-stat-sub">kcal / day</span>
            </>
          ) : (
            <>
              <span className="ov-stat-val empty">—</span>
              <span className="ov-stat-sub">no Health data</span>
            </>
          )}
        </div>
      </div>

      <StrengthCard s={data.strength} />

      <div className="ov-grid-2">
        <div className="ov-stat">
          <span className="ov-stat-label">Training</span>
          <span className={`ov-stat-val${data.sessionsThisWeek > 0 ? " accent" : " empty"}`}>
            {data.sessionsThisWeek}
          </span>
          <span className="ov-stat-sub">sessions this week</span>
        </div>

        <div className="ov-stat">
          <span className="ov-stat-label">PRs</span>
          <span className={`ov-stat-val${data.prThisMonth > 0 ? " gold" : " empty"}`}>
            {data.prThisMonth > 0 ? `+${data.prThisMonth}` : "0"}
          </span>
          <span className="ov-stat-sub">this month</span>
        </div>
      </div>
    </div>
  );
}
