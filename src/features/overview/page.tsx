import { useEffect, useRef, useState } from "react";
import { fetchOverview, type OverviewData } from "./api";

function fmtWeightDelta(
  latest: number | null,
  weekAgo: number | null,
): { text: string; cls: string } {
  if (latest == null || weekAgo == null) return { text: "—", cls: "empty" };
  const d = parseFloat((latest - weekAgo).toFixed(1));
  if (d === 0) return { text: "±0 kg", cls: "" };
  const sign = d > 0 ? "+" : "";
  return { text: `${sign}${d} kg`, cls: d > 0 ? "bad" : "good" };
}
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { useCountUp } from "@shared/hooks/useCountUp";
import { buildAllDataJson, EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS } from "@shared/lib/copyAllData";
import { useTabActivity } from "@app/layout/TabActivityContext";
import { useNav } from "@app/layout/NavContext";
import { TodayView } from "@features/nutrition/today";
import { getConfig, type NutritionConfig } from "@features/nutrition/api";
import { defaultLogDate } from "@features/nutrition/logic";
import "./overview.css";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(): string {
  const d = new Date();
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function pct(val: number, target: number): number {
  if (!target) return 0;
  return Math.min(100, Math.round((val / target) * 100));
}

/* ── Hero Card ─────────────────────────────────────────────────────────── */

function HeroCard({ data }: { data: OverviewData | null }) {
  const today = data?.today;
  const nutritionTargets = data?.nutritionTargets;
  const tdee = data?.tdee;

  const kcal = today?.calories ?? 0;
  const protein = today?.protein ?? 0;
  const kcalTarget = nutritionTargets?.calorieTarget ?? 0;
  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;

  const showBalance = tdee != null && today != null;
  const balance = showBalance ? kcal - (tdee as number) : 0;

  const kcalCount = useCountUp(kcal, 400);
  const proteinCount = useCountUp(protein, 400);

  const [barsReady, setBarsReady] = useState(false);
  const barRafRef = useRef(0);
  useEffect(() => {
    barRafRef.current = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(barRafRef.current);
  }, []);

  const kcalPct = pct(kcal, kcalTarget);
  const proteinPct = pct(protein, proteinTarget);

  if (data && !today && !nutritionTargets) {
    return (
      <section className="page-card ov-hero">
        <p className="ov-hero-eyebrow">Today · {fmtDate()}</p>
        <p className="ov-no-entry">No entry yet — log your first meal in Nutrition.</p>
      </section>
    );
  }

  return (
    <section className="page-card ov-hero">
      <p className="ov-hero-eyebrow">Today · {fmtDate()}</p>

      <div className="ov-hero-row">
        <span className="ov-hero-label">Calories</span>
        <div className="ov-hero-values">
          <span className="ov-hero-num">{kcalCount.toLocaleString()}</span>
          {kcalTarget > 0 && (
            <span className="ov-hero-denom">/ {kcalTarget.toLocaleString()} kcal</span>
          )}
        </div>
        {kcalTarget > 0 && (
          <div className="ov-bar-track">
            <div
              className={`ov-bar-fill calorie${barsReady ? " anim" : ""}${kcalPct >= 100 ? " complete" : ""}`}
              style={{ width: barsReady ? `${kcalPct}%` : "0%" }}
            />
          </div>
        )}
      </div>

      <div className="ov-hero-row">
        <span className="ov-hero-label">Protein</span>
        <div className="ov-hero-values">
          <span className="ov-hero-num">{proteinCount}</span>
          {proteinTarget > 0 && (
            <span className="ov-hero-denom">/ {proteinTarget} g</span>
          )}
        </div>
        {proteinTarget > 0 && (
          <div className="ov-bar-track">
            <div
              className={`ov-bar-fill protein${barsReady ? " anim" : ""}${proteinPct >= 100 ? " complete" : ""}`}
              style={{ width: barsReady ? `${proteinPct}%` : "0%" }}
            />
          </div>
        )}
      </div>

      {showBalance && (
        <div className="ov-hero-balance">
          <span className="ov-hero-label">{balance <= 0 ? "Deficit" : "Surplus"}</span>
          <span className={`ov-hero-balance-num ${balance <= 0 ? "good" : "bad"}`}>
            {balance > 0 ? "+" : balance < 0 ? "−" : ""}
            {Math.abs(balance).toLocaleString()} kcal
          </span>
        </div>
      )}
    </section>
  );
}

/* ── Compound Progress Card ────────────────────────────────────────────── */

function CompoundProgressCard({
  progress,
}: {
  progress: import("./api").CompoundProgress;
}) {
  const [barsReady, setBarsReady] = useState(false);
  const rafRef = useRef(0);
  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const overallPct = Math.round(progress.overall * 100);

  return (
    <section className="page-card ov-compound">
      <p className="ov-card-eyebrow">Performance Progress</p>
      <p className="ov-compound-overall">{overallPct}%</p>
      <div className="ov-compound-list">
        {progress.items.map(({ slug, label, pct }) => {
          const p = Math.round(pct * 100);
          return (
            <div key={slug} className="ov-compound-row">
              <span className="ov-compound-label" title={label}>{label}</span>
              <div className="ov-bar-track ov-compound-track">
                <div
                  className={`ov-bar-fill${barsReady ? " anim" : ""}${p >= 100 ? " complete" : ""}`}
                  style={{ width: barsReady ? `${p}%` : "0%" }}
                />
              </div>
              <span className="ov-compound-pct">{p}%</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Overview Page ─────────────────────────────────────────────────────── */

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [config, setConfig] = useState<NutritionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logDate, setLogDate] = useState(defaultLogDate);
  const activity = useTabActivity();
  const nav = useNav();

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
    getConfig()
      .then(setConfig)
      .catch(() => {/* non-fatal */});
  }, [activity]);

  useCopyButton(() => buildAllDataJson(EXPORT_HEALTH_DAYS, EXPORT_NUTRITION_DAYS));

  if (error) {
    return (
      <div className="page">
        <section className="page-card">
          <p className="auth-error">{error}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      {config ? (
        <TodayView
          config={config}
          date={logDate}
          onDateChange={setLogDate}
          onSaved={() => fetchOverview().then(setData).catch(() => {})}
          hideNav
        />
      ) : (
        <HeroCard data={data} />
      )}

      <div className="ov-grid-2">
        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">Weight</span>
          {(() => {
            const weightDelta = fmtWeightDelta(data?.weightLatest ?? null, data?.weightWeekAgo ?? null);
            return (
              <>
                <span className={`ov-stat-val ${weightDelta.cls}`}>{weightDelta.text}</span>
                <span className="ov-stat-sub">vs 7 days ago</span>
              </>
            );
          })()}
        </button>

        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">TDEE</span>
          {data?.tdee != null ? (
            <>
              <span className="ov-stat-val">
                {data.tdee.toLocaleString()}
                {data.tdeePrev != null && (() => {
                  const diff = data.tdee - data.tdeePrev;
                  const up = diff > 40, down = diff < -40;
                  const dir = up ? "up" : down ? "down" : "flat";
                  const color = up ? "var(--good)" : down ? "var(--bad)" : "var(--ink-4)";
                  return (
                    <span className="ov-tdee-arrow" style={{ color }}>
                      <TrendIcon dir={dir} />
                      {(up || down) ? Math.abs(Math.round(diff)) : null}
                    </span>
                  );
                })()}
              </span>
              <span className="ov-stat-sub">vs 14 days ago</span>
            </>
          ) : (
            <>
              <span className="ov-stat-val empty">{data ? "—" : "0"}</span>
              <span className="ov-stat-sub">{data ? "no Health data" : "kcal/day"}</span>
            </>
          )}
        </button>
      </div>

      {data?.compoundProgress && <CompoundProgressCard progress={data.compoundProgress} />}

      {data && !data.today && data.weightLatest == null && data.sessionsThisWeek === 0 && (
        <section className="page-card ov-onboarding">
          <p className="ov-card-eyebrow">Get started</p>
          <div className="ov-onboarding-links">
            <button type="button" className="ov-onboarding-link" onClick={() => nav("nutrition")}>
              Log a meal in <strong>Nutrition</strong>
            </button>
            <button type="button" className="ov-onboarding-link" onClick={() => nav("training")}>
              Track a workout in <strong>Training</strong>
            </button>
            <button type="button" className="ov-onboarding-link" onClick={() => nav("health")}>
              Log body metrics in <strong>Health</strong>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
