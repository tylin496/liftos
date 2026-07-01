// Nutrition Insight — decision first, evidence below (decision → explanation →
// evidence).
//
// Presentation only. The Recommendation block leads: it's the focal point a
// daily user reads in a second (action + target + reason). The Evidence grid
// sits below as a compact 2-column layout to verify the numbers (Observed rate
// / Target range / Estimated intake / Confidence — no "what to do"). Numbers
// come from the persisted evaluation; the decision is the same pure
// `nutritionDecision` the System card uses, so the two never disagree.

import { useEffect, useRef, useState } from "react";
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
  const [freshTarget, setFreshTarget] = useState(false);
  // Last proposed target we rendered, so we can pulse only when it actually
  // changes — not on first load and not on every re-render.
  const prevProposedRef = useRef<number | null>(null);
  const seenRef = useRef(false);

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

  // Fire a one-shot attention pulse on .ni-prog-new when the recommended target
  // changes vs the last time we showed one — the whole point of the card is
  // "what to do now", so a new target should announce itself. Skips the first
  // load and honors prefers-reduced-motion.
  useEffect(() => {
    if (!state) return;
    const proposed = nutritionDecision(state.evaluation, state.diagnostics).proposedTarget;
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (
      seenRef.current &&
      proposed != null &&
      proposed !== prevProposedRef.current &&
      !reduce
    ) {
      setFreshTarget(true);
    }
    prevProposedRef.current = proposed;
    seenRef.current = true;
  }, [state]);

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
        <span className="page-eyebrow" style={{ margin: 0 }}>Recommendation</span>
        <p className="ni-rec-headline">{decision.actionHeadline}</p>

        <div className="ni-prog">
          <span className="ni-prog-current">{decision.currentTarget.toLocaleString()} kcal</span>
          {decision.proposedTarget != null ? (
            <>
              <span className="ni-prog-arrow">→</span>
              <span
                className={`ni-prog-new${freshTarget ? " is-fresh" : ""}`}
                onAnimationEnd={() => setFreshTarget(false)}
              >
                {decision.proposedTarget.toLocaleString()} kcal
              </span>
            </>
          ) : (
            <span className="ni-prog-hold">Hold</span>
          )}
        </div>

        <p className="ni-rec-reason">{decision.reason}</p>
      </div>

      {/* Evidence — supports the decision; description only, no action. */}
      <div className="ni-evidence">
        <span className="page-eyebrow" style={{ margin: 0 }}>Evidence</span>
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
