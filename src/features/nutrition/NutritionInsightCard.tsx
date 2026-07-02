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
import { MIN_TREND_POINTS, confidenceReason } from "./evaluation";
import { nutritionDecision, paceTone } from "./recommendation";
import "./nutrition.css";

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function fmtRate(kgPerWeek: number): string {
  const sign = kgPerWeek < 0 ? "−" : kgPerWeek > 0 ? "+" : "±";
  return `${sign}${Math.abs(kgPerWeek).toFixed(2)} kg/wk`;
}

// Observed rate is a verdict vs the target pace, so it carries colour (in-range
// green / too-slow gold / gaining red). Confidence describes how sure the
// estimate is — not good/bad — so it stays neutral.
const PACE_STATUS: Record<"good" | "warn" | "bad", string> = {
  good: "status-good",
  warn: "status-gold",
  bad: "status-bad",
};

function EvidenceCell({
  label,
  value,
  status,
  expandable,
  open,
  onToggle,
}: {
  label: string;
  value: string;
  status?: string;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={`ni-cell${expandable ? " ni-cell-expandable" : ""}`}
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? open : undefined}
      onClick={expandable ? onToggle : undefined}
      onKeyDown={
        expandable
          ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
    >
      <span className="ni-cell-label">{label}</span>
      <span className={`ni-cell-value${status ? ` ${status}` : ""}`}>
        {value}
        {expandable && <span className="ni-cell-caret" aria-hidden="true">›</span>}
      </span>
    </div>
  );
}

export function NutritionInsightCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [state, setState] = useState<NutritionStateFull | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [freshTarget, setFreshTarget] = useState(false);
  const [confOpen, setConfOpen] = useState(false);
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

  const loading = !loaded;
  const noData = loaded && !state;

  const e = state?.evaluation;
  const d = state?.diagnostics;
  const decision = e && d ? nutritionDecision(e, d) : null;
  const hasRange = e ? e.targetRange.min !== e.targetRange.max : false;
  // observedRate is a 0-fallback when the trend couldn't be fit (<5 readings);
  // show "—" instead of a fabricated "±0.00 kg/wk".
  const hasTrend = d ? d.weightDataPoints >= MIN_TREND_POINTS : false;
  // Why confidence is capped, revealed on tap — only when a fresh target is the
  // reason (see confidenceReason). Null → the Confidence cell isn't expandable.
  const confReason = !noData && !loading && e && d ? confidenceReason(e, d) : null;

  return (
    <section className={`page-card ni-card${loading ? " loading-card" : ""}`}>
      {/* Decision — the focal point, read first. */}
      <div className="ni-rec">
        <span className="page-eyebrow" style={{ margin: 0 }}>Recommendation</span>
        <p className="ni-rec-headline">
          {loading ? "Loading" : decision ? decision.actionHeadline : "Not enough data yet"}
        </p>

        {loading ? (
          <div className="ni-prog">
            <span className="ni-prog-current">0,000 kcal</span>
            <span className="ni-prog-hold">Hold</span>
          </div>
        ) : decision && decision.proposedTarget == null ? (
          <div className="ni-hero">
            <span className="ni-hero-val">
              {decision.currentTarget.toLocaleString()}
              <span className="metric-unit">kcal</span>
            </span>
            <span className="ni-verdict">Hold</span>
          </div>
        ) : decision && decision.proposedTarget != null ? (
          <div className="ni-prog">
            <span className="ni-prog-current">{decision.currentTarget.toLocaleString()} kcal</span>
            <span className="ni-prog-arrow">→</span>
            <span
              className={`ni-prog-new${freshTarget ? " is-fresh" : ""}`}
              onAnimationEnd={() => setFreshTarget(false)}
            >
              {decision.proposedTarget.toLocaleString()} kcal
            </span>
          </div>
        ) : null}

        <p className="ni-rec-reason">
          {loading
            ? "Loading recommendation reason text placeholder."
            : decision
              ? decision.reason
              : "Log a few days and sync your weight to see how the cut is tracking."}
        </p>
      </div>

      {/* Evidence — supports the decision; description only, no action. */}
      <div className="ni-evidence">
        <span className="page-eyebrow" style={{ margin: 0 }}>Evidence (21d trend)</span>
        <div className="ni-grid">
          <EvidenceCell
            label="Observed rate"
            value={!noData && !loading && hasTrend ? fmtRate(e!.observedRate) : "—"}
            status={
              !noData && !loading && hasTrend && e
                ? (() => {
                    const t = paceTone(e);
                    return t ? PACE_STATUS[t] : undefined;
                  })()
                : undefined
            }
          />
          <EvidenceCell
            label="Target pace"
            value={
              !noData && !loading && hasRange
                ? `−${e!.targetRange.min.toFixed(2)}~−${e!.targetRange.max.toFixed(2)} kg/wk`
                : "—"
            }
          />
          <EvidenceCell
            label="Estimated actual intake"
            value={!noData && !loading ? `≈${d!.estimatedIntake.toLocaleString()} kcal/day` : "—"}
          />
          <EvidenceCell
            label="Confidence"
            value={!noData && !loading ? (CONFIDENCE_LABEL[e!.confidence] ?? e!.confidence) : "—"}
            expandable={confReason != null}
            open={confOpen}
            onToggle={() => setConfOpen((v) => !v)}
          />
        </div>
        {confReason && confOpen && <p className="ni-conf-reason">{confReason}</p>}
      </div>
    </section>
  );
}
