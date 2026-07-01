// Nutrition Insight — evidence on top, a self-contained decision below.
//
// Presentation only. The top block is pure analysis (Observed rate / Target
// range / Estimated intake / Confidence — no "what to do"); the Recommendation
// block is a complete decision (action + target + reason). Numbers come from the
// persisted evaluation; the decision is the same pure `nutritionDecision` the
// System card uses, so the two never disagree.

import { useEffect, useState } from "react";
import { getNutritionState, type NutritionStateFull } from "./evaluationApi";
import { nutritionDecision } from "./recommendation";
import "./nutrition.css";

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function fmtRate(kgPerWeek: number): string {
  const sign = kgPerWeek < 0 ? "−" : kgPerWeek > 0 ? "+" : "±";
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)} kg/wk`;
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
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

  const { evaluation: e, diagnostics: d } = state;
  const decision = nutritionDecision(e, d);
  const hasRange = e.targetRange.min !== e.targetRange.max;

  return (
    <section className="page-card ni-card">
      <p className="page-eyebrow">NUTRITION INSIGHT</p>

      {/* Evidence — description only, no action. */}
      <div className="ni-rows">
        <EvidenceRow label="Observed rate" value={fmtRate(e.observedRate)} />
        <EvidenceRow
          label="Target range"
          value={hasRange ? `−${e.targetRange.min.toFixed(2)} – −${e.targetRange.max.toFixed(2)} kg/wk` : "—"}
        />
        <EvidenceRow label="Estimated intake" value={`≈${d.estimatedIntake.toLocaleString()} kcal/day`} />
        <EvidenceRow label="Confidence" value={CONFIDENCE_LABEL[e.confidence] ?? e.confidence} />
      </div>

      {/* Decision — a complete recommendation on its own. */}
      <div className="ni-rec">
        <span className="ni-rec-label">Recommendation</span>
        <p className="ni-rec-headline">{decision.actionHeadline}</p>

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

        <div className="ni-rec-field">
          <span className="ni-rec-key">Reason</span>
          <p className="ni-rec-reason">{decision.reason}</p>
        </div>
      </div>
    </section>
  );
}
