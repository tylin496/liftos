// Nutrition Insight — decision first, evidence below (decision → explanation →
// evidence).
//
// Presentation only. The Recommendation block leads: it's the focal point a
// daily user reads in a second (action + target + reason). The Evidence grid
// sits below as a compact 2-column layout to verify the numbers (Observed rate
// / Target range / Estimated intake / Confidence — no "what to do"). Numbers
// come from the persisted evaluation; the decision is the same pure
// `nutritionDecision` the System card uses, so the two never disagree.

import { useEffect, useState } from "react";
import { getNutritionState, type NutritionStateFull } from "./evaluationApi";
import { MIN_TREND_POINTS } from "./evaluation";
import { nutritionDecision } from "./recommendation";
import "./nutrition.css";

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function fmtRate(kgPerWeek: number): string {
  const sign = kgPerWeek < 0 ? "−" : kgPerWeek > 0 ? "+" : "±";
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)} kg/wk`;
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="ni-cell">
      <span className="ni-cell-label">{label}</span>
      <span className="ni-cell-value">{value}</span>
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

  if (!loaded) return null;

  if (!state) {
    return (
      <section className="page-card ni-card">
        <p className="ov-no-entry" style={{ textAlign: "left" }}>
          Not enough data yet — log a few days and sync your weight to see how the cut is tracking.
        </p>
      </section>
    );
  }

  const { evaluation: e, diagnostics: d } = state;
  const decision = nutritionDecision(e, d);
  const hasRange = e.targetRange.min !== e.targetRange.max;
  // observedRate is a 0-fallback when the trend couldn't be fit (<5 readings);
  // show "—" instead of a fabricated "±0.00 kg/wk".
  const hasTrend = d.weightDataPoints >= MIN_TREND_POINTS;

  return (
    <section className="page-card ni-card">
      {/* Decision — the focal point, read first. */}
      <div className="ni-rec">
        <p className="ni-rec-headline">{decision.actionHeadline}</p>

        <div className="ni-rec-targets">
          <div className="ni-rec-field">
            <span className="ni-rec-key">Current target</span>
            <span className="ni-rec-target">{decision.currentTarget.toLocaleString()} kcal</span>
          </div>
          {decision.proposedTarget != null && (
            <div className="ni-rec-field">
              <span className="ni-rec-key">New target</span>
              <span className="ni-rec-target">{decision.proposedTarget.toLocaleString()} kcal</span>
            </div>
          )}
        </div>

        <p className="ni-rec-reason">{decision.reason}</p>
      </div>

      {/* Evidence — supports the decision; description only, no action. */}
      <div className="ni-evidence">
        <span className="ni-evidence-label">Evidence</span>
        <div className="ni-grid">
          <EvidenceCell label="Observed rate" value={hasTrend ? fmtRate(e.observedRate) : "—"} />
          <EvidenceCell
            label="Target range"
            value={hasRange ? `−${e.targetRange.min.toFixed(2)} – −${e.targetRange.max.toFixed(2)} kg/wk` : "—"}
          />
          <EvidenceCell label="Estimated intake" value={`≈${d.estimatedIntake.toLocaleString()} kcal/day`} />
          <EvidenceCell label="Confidence" value={CONFIDENCE_LABEL[e.confidence] ?? e.confidence} />
        </div>
      </div>
    </section>
  );
}
