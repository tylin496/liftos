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
import { useToast } from "@shared/components/Toast";
import { useCountUp } from "@shared/hooks/useCountUp";
import { TrendIcon } from "@shared/components/TrendIcon";
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

/* ── Training Health Card ──────────────────────────────────────────────── */

// Retention < 85% reads as a deeper hole than a recent dip — surface it as
// "Review" (urgent) vs "Watch" (keep an eye on it).
function exerciseRetention(ex: import("./api").StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

function ExerciseRow({ exercise }: { exercise: import("./api").StrengthExercise }) {
  const retention = exerciseRetention(exercise);
  const retPct = Math.round(retention * 100);
  const isWatch = exercise.status === "watch";
  const tier = retention < 0.85 ? "Review" : "Watch";
  return (
    <div className={`ov-th-ex-row${isWatch ? " watch" : ""}`}>
      <span className="ov-th-ex-name">
        {isWatch && <span className="ov-th-ex-icon" aria-hidden>⚠</span>}
        {exercise.name}
      </span>
      <span className={`ov-th-ex-pct${isWatch ? " bad" : ""}`}>{retPct}%</span>
      {isWatch && <span className="ov-th-ex-trend">{tier}</span>}
    </div>
  );
}

const ON_TRACK_PREVIEW = 5;

function TrainingHealthCard({
  strength,
  compoundProgress,
  onNav,
}: {
  strength: import("./api").StrengthSummary;
  compoundProgress: import("./api").CompoundProgress | null;
  onNav: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllOnTrack, setShowAllOnTrack] = useState(false);
  const hasData = strength.total > 0;
  const retentionPct = compoundProgress ? Math.round(compoundProgress.overall * 100) : null;
  const retCount = useCountUp(retentionPct ?? 0, 600);
  const attention = strength.watch;

  // Attention always sits above On Track and is ordered worst-first
  // (lowest retention), so the most urgent exercise is the first thing read.
  const watchExercises = strength.exercises
    .filter((e) => e.status === "watch")
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));
  const onTrackExercises = strength.exercises.filter((e) => e.status !== "watch");
  const onTrackVisible = showAllOnTrack
    ? onTrackExercises
    : onTrackExercises.slice(0, ON_TRACK_PREVIEW);
  const onTrackHidden = onTrackExercises.length - onTrackVisible.length;

  if (!hasData) {
    return (
      <button type="button" className="page-card ov-training-health ov-training-health--nav" onClick={onNav}>
        <span className="ov-th-label">Training</span>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          Log at least 4 sessions per exercise to see training health.
        </p>
      </button>
    );
  }

  return (
    <div className={`page-card ov-training-health${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        className="ov-th-summary"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="ov-th-top">
          <span className="ov-th-label">Training</span>
          <span className="ov-th-chevron" aria-hidden>▾</span>
        </div>

        {retentionPct !== null && (
          <div className="ov-th-ret-hero">
            <span className={`ov-th-ret-big${retentionPct >= 95 ? " good" : retentionPct >= 85 ? "" : " bad"}`}>
              {retCount}%
            </span>
            <span className="ov-th-ret-sub">Retention</span>
          </div>
        )}

        <div className="ov-th-status">
          {attention > 0 ? (
            <span className="ov-th-attention">{attention} Attention</span>
          ) : (
            <span className="ov-th-all-good">All exercises on track</span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="ov-th-expanded">
          {watchExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head attention">
                Attention ({watchExercises.length})
              </div>
              {watchExercises.map((ex) => (
                <ExerciseRow key={ex.slug} exercise={ex} />
              ))}
            </div>
          )}

          {onTrackExercises.length > 0 && (
            <div className="ov-th-section">
              <div className="ov-th-sect-head">
                On Track ({onTrackExercises.length})
              </div>
              {onTrackVisible.map((ex) => (
                <ExerciseRow key={ex.slug} exercise={ex} />
              ))}
              {(onTrackHidden > 0 || showAllOnTrack) && (
                <button
                  type="button"
                  className="ov-th-show-more"
                  onClick={() => setShowAllOnTrack((v) => !v)}
                >
                  {showAllOnTrack ? "Show less" : `Show ${onTrackHidden} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <button type="button" className="ov-th-nav-btn" onClick={onNav}>
          Open Training →
        </button>
      )}
    </div>
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
  const toast = useToast();
  const tdeeCount = useCountUp(data?.tdee ?? 0, 500);

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
          onSaved={() => {
            toast("Logged", "success");
            fetchOverview().then(setData).catch(() => {});
          }}
          hideNav
        />
      ) : (
        <HeroCard data={data} />
      )}

      <div className="ov-grid-2">
        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">Weight</span>
          {data?.weightLatest != null ? (
            (() => {
              const weightDelta = fmtWeightDelta(data.weightLatest, data?.weightWeekAgo ?? null);
              return (
                <>
                  <span className="ov-stat-val">{data.weightLatest} kg</span>
                  <span className={`ov-stat-sub${weightDelta.cls ? ` ${weightDelta.cls}` : ""}`}>
                    {weightDelta.text} / 7 days
                  </span>
                </>
              );
            })()
          ) : (
            <>
              <span className="ov-stat-val empty">{data ? "—" : "–"}</span>
              <span className="ov-stat-sub">{data ? "no data" : "kg"}</span>
            </>
          )}
        </button>

        <button type="button" className="ov-stat" onClick={() => nav("health")}>
          <span className="ov-stat-label">TDEE</span>
          {data?.tdee != null ? (
            <>
              <span className="ov-stat-val">
                {tdeeCount.toLocaleString()}
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

      {data && (
        <TrainingHealthCard
          strength={data.strength}
          compoundProgress={data.compoundProgress}
          onNav={() => nav("training")}
        />
      )}
    </div>
  );
}
