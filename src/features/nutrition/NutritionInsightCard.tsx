// Nutrition Insight — decision first, evidence below (decision → explanation →
// evidence).
//
// Presentation only. The Recommendation block leads: it's the focal point a
// daily user reads in a second (action + target + reason). Below it, the
// supporting numbers are grouped by the order a reader judges them, not by
// data source or time window:
//   - Weight-loss pace — Observed (21d regression) paired against Target
//     (fixed band from cut mode) side by side: this is the one comparison
//     that actually drives the decision.
//   - Est. intake — the same 21d regression's implied intake, on its own row:
//     the *why* behind the pace reading.
//   - Confidence — a composite of trend quality (21d) and target tenure
//     (daysOnTarget), sunk to the bottom as a closing stamp rather than a
//     fourth parallel number, since it's meta (about the read) not a measurement.
// Numbers come from the persisted evaluation; the decision is the same pure
// `nutritionDecision` the System card uses, so the two never disagree.

import { useEffect, useRef, useState } from "react";
import { getNutritionState, type NutritionStateFull } from "./evaluationApi";
import { MIN_TREND_POINTS, confidenceReason } from "./evaluation";
import { nutritionDecision, rateTone } from "./recommendation";
import "./nutrition.css";

/* Static integer — count-up dropped app-wide (only progress-bar / activity-ring
   cards animate their number). This card has neither, so the target just shows.
   `delayMs` kept on props for callers. */
function AnimatedInt({ value }: { value: number; delayMs?: number }) {
  return <>{value.toLocaleString()}</>;
}

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

// The confidence reason ends with a tenure phrase — "today" or "N day(s)".
// Lift that phrase one tier above the caption so the day count reads as the
// point of the sentence, not buried in the footnote.
function renderConfReason(reason: string) {
  const m = reason.match(/(today|\d+\s+days?)(?=\.?$)/);
  if (!m) return reason;
  const start = m.index!;
  const end = start + m[0].length;
  return (
    <>
      {reason.slice(0, start)}
      <strong className="ni-conf-day">{m[0]}</strong>
      {reason.slice(end)}
    </>
  );
}

// Observed rate carries a leading dot coloured by distance from the target
// band (in-band green / near an edge amber / materially off red) — both too
// slow and too fast score worse the further they drift, so this isn't a
// simple low=bad/high=good read. The rate value stays neutral ink — colour
// lives on the dot only, not doubled onto the number.

// Leading status dot before Observed rate / Confidence values — same
// good/gold/bad language as the text colour above, just a glance-only mark.
const RATE_DOT: Record<"good" | "warn" | "bad", "good" | "gold" | "bad"> = {
  good: "good",
  warn: "gold",
  bad: "bad",
};
const CONFIDENCE_DOT: Record<string, "good" | "gold" | "bad"> = {
  high: "good",
  medium: "gold",
  low: "bad",
};

// Reading-order weight, not layout: the four cells are analysis (Observed →
// Est. intake → Confidence) plus one constant (Target pace), so the constant
// is the only one dropped a tier below the shared default.
function EvidenceCell({
  label,
  value,
  dot,
  full,
  expandable,
  open,
  onToggle,
  emphasis,
}: {
  label: string;
  value: string;
  dot?: "good" | "gold" | "bad";
  full?: boolean;
  expandable?: boolean;
  open?: boolean;
  onToggle?: () => void;
  emphasis?: "primary" | "tertiary" | "quiet";
}) {
  return (
    <div
      className={`ni-cell${full ? " ni-cell-full" : ""}${expandable ? " ni-cell-expandable" : ""}`}
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
      <span className={`ni-cell-value${emphasis ? ` ni-cell-value--${emphasis}` : ""}`}>
        {dot && <span className={`ni-status-dot status-${dot}`} aria-hidden="true" />}
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
    <section id="nutrition-insight-card" className={`page-card ni-card${loading ? " loading-card" : ""}`}>
      {/* Decision — the focal point, read first. */}
      <div className="ni-rec">
        <span className="page-eyebrow" style={{ margin: 0 }}>Recommendation</span>
        <p className="ni-rec-headline">
          {loading ? "Loading…" : decision ? decision.actionHeadline : "Not enough data yet"}
        </p>

        {loading ? (
          <div className="ni-prog">
            <span className="ni-prog-current">0,000 kcal</span>
            <span className="ni-prog-hold">Hold</span>
          </div>
        ) : decision && decision.proposedTarget == null ? (
          <div className="ni-hero">
            <span className="ni-hero-val">
              <AnimatedInt value={decision.currentTarget} />
              <span className="metric-unit">kcal</span>
            </span>
            <span className="ni-verdict">✓ Hold</span>
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
            <span className="ni-prog-delta">
              {decision.proposedTarget < decision.currentTarget ? "▼" : "▲"}{" "}
              {Math.abs(decision.currentTarget - decision.proposedTarget).toLocaleString()}/day
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

      {/* Supporting numbers, grouped by the order a reader judges them. */}
      <div className="ni-evidence">
        {/* The comparison that drives the decision: Observed vs Target, paired. */}
        <div className="ni-group">
          <span className="page-eyebrow" style={{ margin: 0 }}>Weight-loss pace</span>
          <div className="ni-grid">
            <EvidenceCell
              label="Observed rate · 21d"
              value={
                !noData && !loading && hasTrend
                  ? `${e!.observedRate < 0 ? "−" : e!.observedRate > 0 ? "+" : "±"}${Math.abs(e!.observedRate).toFixed(2)} kg/wk`
                  : "—"
              }
              dot={
                !noData && !loading && hasTrend && e
                  ? (() => {
                      const t = rateTone(e);
                      return t ? RATE_DOT[t] : undefined;
                    })()
                  : undefined
              }
              emphasis="primary"
            />
            <EvidenceCell
              label="Target pace · fixed"
              value={
                !noData && !loading && hasRange
                  ? `−${e!.targetRange.min.toFixed(2)} – ${e!.targetRange.max.toFixed(2)} kg/wk`
                  : "—"
              }
              emphasis="quiet"
            />
          </div>
        </div>

        {/* Why the pace reads the way it does — the reason, on its own row. */}
        <EvidenceCell
          label="Est. intake · 21d"
          value={
            !noData && !loading && hasTrend
              ? `≈${d!.estimatedIntake.toLocaleString()} kcal/day`
              : "—"
          }
          full
        />

        {/* Confidence — meta tier, sinks to the bottom as a closing stamp
            rather than a fourth parallel number. */}
        <EvidenceCell
          label="Confidence"
          value={!noData && !loading ? (CONFIDENCE_LABEL[e!.confidence] ?? e!.confidence) : "—"}
          dot={!noData && !loading && e ? CONFIDENCE_DOT[e.confidence] : undefined}
          expandable={confReason != null}
          open={confOpen}
          onToggle={() => setConfOpen((v) => !v)}
          emphasis="tertiary"
          full
        />
        {/* Revealed reason spans the card, but reads as part of Confidence.
            The tenure phrase (today / N days) is lifted one tier to carry it. */}
        {confReason && confOpen && (
          <p className="ni-conf-reason">{renderConfReason(confReason)}</p>
        )}
      </div>
    </section>
  );
}
