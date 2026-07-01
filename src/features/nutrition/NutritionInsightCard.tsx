// Nutrition Insight — the detailed, read-only view of the shared evaluation.
//
// Presentation only: it reads the persisted state and lays it out. No business
// logic, no recompute — the numbers come straight from `getNutritionState()`.
// Recompute happens in the data layer (evaluationApi) when new data lands.

import { useEffect, useState } from "react";
import { getNutritionState, type NutritionStateFull } from "./evaluationApi";
import "./nutrition.css";

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function fmtRate(kgPerWeek: number): string {
  const sign = kgPerWeek < 0 ? "−" : kgPerWeek > 0 ? "+" : "±";
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)} kg/wk`;
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ni-row">
      <span className="ni-row-label">{label}</span>
      <span className="ni-row-value">{value}</span>
    </div>
  );
}

export function NutritionInsightCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [state, setState] = useState<NutritionStateFull | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getNutritionState()
      .then((s) => {
        if (alive) {
          setState(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // Nothing to render until the first read resolves (avoids a flash of empty).
  if (!loaded) return null;

  if (!state) {
    return (
      <section className="page-card ni-card">
        <p className="page-eyebrow">NUTRITION INSIGHT</p>
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          Not enough data yet — log a few days and sync your weight to see how the cut is tracking.
        </p>
      </section>
    );
  }

  const { evaluation: e, diagnostics: d, recommendation: r } = state;
  const hasRange = e.targetRange.min !== e.targetRange.max;

  return (
    <section className="page-card ni-card">
      <p className="page-eyebrow">NUTRITION INSIGHT</p>

      <div className="ni-rows">
        <InsightRow label="Target" value={`${d.calorieTarget.toLocaleString()} kcal`} />
        <InsightRow label="Observed rate" value={fmtRate(e.observedRate)} />
        <InsightRow
          label="Target range"
          value={hasRange ? `${e.targetRange.min.toFixed(2)}–${e.targetRange.max.toFixed(2)} kg/wk` : "—"}
        />
        <InsightRow label="Estimated intake" value={`${d.estimatedIntake.toLocaleString()} kcal/day`} />
        <InsightRow label="Confidence" value={CONFIDENCE_LABEL[e.confidence] ?? e.confidence} />
      </div>

      {r && (
        <div className="ni-rec">
          <span className="ni-rec-label">Recommendation</span>
          <p className="ni-rec-title">{r.title}</p>
          <p className="ni-rec-sub">{r.subtitle}</p>
        </div>
      )}
    </section>
  );
}
