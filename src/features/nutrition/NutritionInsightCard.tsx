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
import { MIN_TREND_POINTS } from "./evaluation";
import { nutritionDecision } from "./recommendation";
import "./nutrition.css";

/* Static integer — count-up dropped app-wide (only progress-bar / activity-ring
   cards animate their number). This card has neither, so the target just shows.
   `delayMs` kept on props for callers. */
function AnimatedInt({ value }: { value: number; delayMs?: number }) {
  return <>{value.toLocaleString()}</>;
}

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

// Leading status dot before the Confidence value — a glance-only mark that
// mirrors the confidence level's good/gold/bad language.
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
  emphasis,
}: {
  label: string;
  value: string;
  dot?: "good" | "gold" | "bad";
  full?: boolean;
  emphasis?: "primary" | "tertiary" | "quiet";
}) {
  return (
    <div className={`ni-cell${full ? " ni-cell-full" : ""}`}>
      <span className="ni-cell-label">{label}</span>
      <span className={`ni-cell-value${emphasis ? ` ni-cell-value--${emphasis}` : ""}`}>
        {dot && <span className={`ni-status-dot status-${dot}`} aria-hidden="true" />}
        {value}
      </span>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// Pace meter — the one comparison that drives the decision, drawn instead of
// asked. Axis = weekly loss magnitude (kg/wk); the target band is the middle
// third of the track and the observed rate is a marker on it, so "is −0.71
// inside −0.60 – −0.90?" is answered by eye, not arithmetic. The band is
// centred by construction: the domain pads one band-width on each side
//   domainMin = lo − w,  span = 3w   (w = hi − lo)
// which fixes the band at [33.33%, 66.67%] and leaves a full band-width of
// runway for the marker to fall out either edge. Marker green in-band, gold
// off — same in/off language the card uses everywhere else.
function PaceMeter({
  observedRate,
  lo,
  hi,
}: {
  observedRate: number;
  lo: number;
  hi: number;
}) {
  const obs = Math.abs(observedRate);
  const w = hi - lo;
  const domainMin = lo - w;
  const span = 3 * w;
  // Clamp keeps the marker off the rounded ends; extreme reads still read as
  // "pinned past the edge" without being clipped.
  const markerPct = clamp(((obs - domainMin) / span) * 100, 4, 96);
  const inState = obs >= lo && obs <= hi;
  const tone = inState ? "good" : "gold";

  const sign = observedRate < 0 ? "−" : observedRate > 0 ? "+" : "±";
  // Caption only fires off-band, where it adds the "why" the meter can't show;
  // in-band it would just restate the marker sitting inside the green — dropped.
  const note =
    obs < lo ? "below range — losing too slowly" : "above range — losing too fast";

  return (
    <div className="ni-pace">
      <div className="ni-pace-head">
        <span className="ni-cell-label">Observed rate · 21d</span>
        <span className="ni-pace-obs">
          <span className={`ni-status-dot status-${tone}`} aria-hidden="true" />
          {sign}
          {obs.toFixed(2)} kg/wk
        </span>
      </div>

      <div className="ni-meter">
        <div className="ni-meter-track">
          <div className={`ni-meter-band ${inState ? "is-in" : "is-off"}`} />
          <div
            className={`ni-meter-marker ${inState ? "is-in" : "is-off"}`}
            style={{ left: `${markerPct}%` }}
          />
        </div>
        <div className="ni-meter-scale">
          <span className="ni-meter-end">slower</span>
          <span className="ni-meter-tick" style={{ left: "33.33%" }}>
            −{lo.toFixed(2)}
          </span>
          <span className="ni-meter-tick" style={{ left: "66.67%" }}>
            −{hi.toFixed(2)}
          </span>
          <span className="ni-meter-end ni-meter-end--right">faster</span>
        </div>
      </div>

      {!inState && <p className="ni-pace-note is-off">{note}</p>}
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

  const loading = !loaded;
  const noData = loaded && !state;

  const e = state?.evaluation;
  const d = state?.diagnostics;
  const decision = e && d ? nutritionDecision(e, d) : null;
  const hasRange = e ? e.targetRange.min !== e.targetRange.max : false;
  // observedRate is a 0-fallback when the trend couldn't be fit (<5 readings);
  // show "—" instead of a fabricated "±0.00 kg/wk".
  const hasTrend = d ? d.weightDataPoints >= MIN_TREND_POINTS : false;

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

        {/* Current intake goal's tenure — how long this calorie target has been
            active (daysOnTarget). Always visible: it used to surface only inside
            the capped-confidence tap-reason, so at High confidence it vanished.
            Worded "this target" to stay distinct from the cut's total Day-N on
            the Overview Cut Progress card. */}
        {!loading && decision && d && hasTrend && (
          <p className="ni-rec-tenure">
            On this target ·{" "}
            <strong className="ni-conf-day">
              {d.daysOnTarget <= 0
                ? "today"
                : `${d.daysOnTarget} ${d.daysOnTarget === 1 ? "day" : "days"}`}
            </strong>
          </p>
        )}
      </div>

      {/* Supporting numbers, grouped by the order a reader judges them. */}
      <div className="ni-evidence">
        {/* The comparison that drives the decision: Observed vs Target, paired. */}
        <div className="ni-group">
          <span className="page-eyebrow" style={{ margin: 0 }}>Weight-loss pace</span>
          {!noData && !loading && hasTrend && hasRange && e ? (
            <PaceMeter
              observedRate={e.observedRate}
              lo={e.targetRange.min}
              hi={e.targetRange.max}
            />
          ) : (
            <div className="ni-cell ni-cell-full">
              <span className="ni-cell-label">Observed vs target</span>
              <span className="ni-cell-value">—</span>
            </div>
          )}
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
            rather than a fourth parallel number. The "why capped" tap-reason was
            dropped: its only content was the target's tenure, which the always-on
            "On this target · N days" line above now states plainly. */}
        <EvidenceCell
          label="Confidence"
          value={!noData && !loading ? (CONFIDENCE_LABEL[e!.confidence] ?? e!.confidence) : "—"}
          dot={!noData && !loading && e ? CONFIDENCE_DOT[e.confidence] : undefined}
          emphasis="tertiary"
          full
        />
      </div>
    </section>
  );
}
