import { useEffect, useRef, useState } from "react";
import { fetchOverview, type OverviewData, type StrengthSummary } from "./api";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { useCountUp } from "@shared/hooks/useCountUp";
import { buildAllDataJson } from "@shared/lib/copyAllData";
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

/* ── Hero Card ─────────────────────────────────────────────────────────── */
// Design: large primary numbers (34px mono) with muted targets, 6px spring
// bars that animate 0 → target with a slight overshoot on mount.

function HeroCard({ data }: { data: OverviewData }) {
  const { today, nutritionTargets } = data;

  const kcal = today?.calories ?? 0;
  const protein = today?.protein ?? 0;
  const kcalTarget = nutritionTargets?.calorieTarget ?? 0;
  const proteinTarget = nutritionTargets?.proteinTarget ?? 0;

  // Hooks before any early return (React rules)
  const kcalCount = useCountUp(kcal, 700);
  const proteinCount = useCountUp(protein, 600);

  // Trigger bar spring after one frame so the 0 → pct% transition plays
  const [barsReady, setBarsReady] = useState(false);
  const barRafRef = useRef(0);
  useEffect(() => {
    barRafRef.current = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(barRafRef.current);
  }, []);

  const kcalPct = pct(kcal, kcalTarget);
  const proteinPct = pct(protein, proteinTarget);

  if (!today && !nutritionTargets) {
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
        <div className="ov-hero-values">
          <span className="ov-hero-num">{kcalCount.toLocaleString()}</span>
          {kcalTarget > 0 && (
            <span className="ov-hero-denom">/ {kcalTarget.toLocaleString()} kcal</span>
          )}
        </div>
        {kcalTarget > 0 && (
          <div className="ov-bar-track">
            <div
              className={`ov-bar-fill${barsReady ? " anim" : ""}${kcalPct >= 100 ? " complete" : ""}`}
              style={{ width: barsReady ? `${kcalPct}%` : "0%" }}
            />
          </div>
        )}
      </div>

      <div className="ov-hero-row">
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
    </section>
  );
}

/* ── Performance Card ──────────────────────────────────────────────────── */
// Design: simplified — dominant status as headline, compact arrow pills,
// attention items slide in one at a time.

function StrengthCard({ s }: { s: StrengthSummary }) {
  if (s.total === 0) {
    return (
      <section className="page-card ov-strength">
        <p className="ov-card-eyebrow">Performance</p>
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
      <p className="ov-card-eyebrow">Performance</p>
      <p className={`ov-strength-dominant${dominantCls ? ` ov-strength-${dominantCls}` : ""}`}>
        {dominant}
      </p>
      <p className="ov-strength-count">{s.total} exercises</p>
      <div className="ov-strength-pills">
        {s.improving > 0 && (
          <span
            className="ov-strength-pill ov-strength-pill-good"
            style={{ animationDelay: "80ms" }}
          >
            ↑{s.improving}
          </span>
        )}
        {s.stable > 0 && (
          <span
            className="ov-strength-pill ov-strength-pill-stable"
            style={{ animationDelay: "160ms" }}
          >
            →{s.stable}
          </span>
        )}
        {s.watch > 0 && (
          <span
            className="ov-strength-pill ov-strength-pill-watch"
            style={{ animationDelay: "240ms" }}
          >
            ↓{s.watch}
          </span>
        )}
      </div>
      {watchList.length > 0 && (
        <>
          <p className="ov-strength-attention-label">Needs Attention</p>
          <ul className="ov-strength-detail">
            {watchList.map((e, i) => (
              <li key={e.slug} style={{ animationDelay: `${320 + i * 60}ms` }}>
                {e.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ── Overview Page ─────────────────────────────────────────────────────── */

export function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useCopyButton(buildAllDataJson);

  // Unconditional hooks — fall back to 0 until data arrives, then count up
  const tdeeCount = useCountUp(data?.tdee ?? 0, 700);
  const sessionsCount = useCountUp(data?.sessionsThisWeek ?? 0, 450);
  const prsCount = useCountUp(data?.prThisMonth ?? 0, 450);

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
        <section className="page-card ov-hero">
          <div className="skel skel-line--sm" style={{ width: "120px", marginBottom: "16px" }} />
          <div className="skel skel-num" style={{ width: "160px", marginBottom: "8px" }} />
          <div className="skel skel-bar" style={{ width: "100%", marginBottom: "20px" }} />
          <div className="skel skel-num" style={{ width: "100px", marginBottom: "8px" }} />
          <div className="skel skel-bar" style={{ width: "100%" }} />
        </section>
        <div className="ov-grid-2">
          <div className="ov-stat">
            <div className="skel skel-line--sm" style={{ width: "50px", marginBottom: "8px" }} />
            <div className="skel skel-num" style={{ width: "70px" }} />
          </div>
          <div className="ov-stat">
            <div className="skel skel-line--sm" style={{ width: "40px", marginBottom: "8px" }} />
            <div className="skel skel-num" style={{ width: "80px" }} />
          </div>
        </div>
        <section className="page-card ov-strength">
          <div className="skel skel-line--sm" style={{ width: "80px", marginBottom: "12px" }} />
          <div className="skel skel-line--lg" style={{ width: "110px", marginBottom: "6px" }} />
          <div className="skel skel-line--sm" style={{ width: "80px", marginBottom: "16px" }} />
          <div style={{ display: "flex", gap: "8px" }}>
            <div className="skel skel-line--sm" style={{ width: "40px", borderRadius: "99px" }} />
            <div className="skel skel-line--sm" style={{ width: "32px", borderRadius: "99px" }} />
          </div>
        </section>
        <div className="ov-grid-2">
          <div className="ov-stat">
            <div className="skel skel-line--sm" style={{ width: "50px", marginBottom: "8px" }} />
            <div className="skel skel-num" style={{ width: "30px" }} />
          </div>
          <div className="ov-stat">
            <div className="skel skel-line--sm" style={{ width: "30px", marginBottom: "8px" }} />
            <div className="skel skel-num" style={{ width: "40px" }} />
          </div>
        </div>
      </div>
    );
  }

  const weightDelta = fmtWeightDelta(data.weightLatest, data.weightWeekAgo);

  return (
    <div className="page">
      <HeroCard data={data} />

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
              <span className="ov-stat-val">{tdeeCount.toLocaleString()}</span>
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
            {sessionsCount}
          </span>
          <span className="ov-stat-sub">sessions this week</span>
        </div>

        <div className="ov-stat">
          <span className="ov-stat-label">PRs</span>
          <span className={`ov-stat-val${data.prThisMonth > 0 ? " gold" : " empty"}`}>
            {data.prThisMonth > 0 ? `+${prsCount}` : "0"}
          </span>
          <span className="ov-stat-sub">this month</span>
        </div>
      </div>
    </div>
  );
}
