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
import { getNutritionState, recomputeAndPersist, type NutritionStateFull } from "./evaluationApi";
import { MIN_TREND_POINTS, STATUS_EPS } from "./evaluation";
import { nutritionDecision, rateTone, paceTone } from "./recommendation";
import { saveConfig, phaseDefsFromConfig, targetsFromConfig } from "./api";
import { useNutritionConfig } from "./NutritionConfigContext";
import { ErrorState } from "@shared/components/ErrorState";
import { useToast } from "@shared/components/Toast";
import { useNav } from "@app/layout/NavContext";
import { useIsReadOnly } from "@app/layout/SessionContext";
import { clamp } from "@shared/lib/num";
import "./nutrition.css";

const CONFIDENCE_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

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
  accelDirection,
  optimal,
}: {
  observedRate: number;
  lo: number;
  hi: number;
  accelDirection: "faster" | "slowing" | null;
  /** Earned-Optimal celebration flag (paceTone gold — top-slice AND settled
      confidence), computed by the caller so this meter's gold matches the pace
      pill and the Overview Weight card exactly. */
  optimal: boolean;
}) {
  const obs = Math.abs(observedRate);
  const w = hi - lo;
  const domainMin = lo - w;
  const span = 3 * w;
  // Clamp keeps the marker off the rounded ends; extreme reads still read as
  // "pinned past the edge" without being clipped.
  const markerPct = clamp(((obs - domainMin) / span) * 100, 4, 96);
  // Same STATUS_EPS deadband evaluate()/rateTone use: a read in the edge
  // slivers is still on_target to the engine (dot green, decision "maintain"),
  // so the band/caption must not contradict it with a raw in-band check.
  const inState = obs >= lo - STATUS_EPS && obs <= hi + STATUS_EPS;
  // Same rateTone the Overview Weight card's Rate arrow uses (band-aware
  // severity, not just in/off) — one source, so the dot, the arrow, and
  // Overview never disagree on how far off this number is. Gold, though, is a
  // celebration and must be EARNED: rateTone paints any top-slice rate gold on
  // magnitude alone, but on unsettled data (fresh target / Calibrating) that's
  // premature — the Overview card gates its gold on paceTone (confidence-aware),
  // so here a top-slice rate that isn't `optimal` yet reads as plain in-band
  // good. Both surfaces then flip to gold together, never one alone.
  const rTone = rateTone({ observedRate, targetRange: { min: lo, max: hi } });
  const tone = optimal ? "gold" : rTone === "gold" ? "good" : (rTone ?? "good");

  const sign = observedRate < 0 ? "−" : observedRate > 0 ? "+" : "±";
  // Caption only fires off-band, where it adds the "why" the meter can't show;
  // in-band it would just restate the marker sitting inside the green — dropped.
  const note =
    obs < lo ? "below range — losing too slowly" : "above range — losing too fast";

  return (
    <div className="ni-pace">
      <div className="ni-pace-head">
        <span className="ni-cell-label">Observed rate 21d</span>
        <span className="ni-pace-obs">
          <span className={`ni-status-dot status-${tone}`} aria-hidden="true" />
          {sign}
          {obs.toFixed(2)} kg/wk
          {/* Rate-TREND arrow: the glyph is the second-order read — is the loss
              speeding up (▲) or slowing toward a plateau (▼)? — NOT the weight's
              own direction. Colour reads the trend against the band: a still-safe
              acceleration is good (green); a slowdown warns even while in-band
              (early-plateau catch), orange; any drift out of the band is orange/
              red regardless of trend. Silent when the trend can't speak (rate
              holding / too few readings). How good the value IS stays on the dot,
              never here — so the arrow never goes gold. */}
          {accelDirection && (
            <span
              className={`ni-pace-rate-arrow is-${
                rTone === "bad"
                  ? "bad"
                  : rTone === "warn"
                    ? "warn"
                    : accelDirection === "slowing"
                      ? "warn"
                      : "good"
              }`}
              aria-hidden
            >
              {accelDirection === "faster" ? "▲" : "▼"}
            </span>
          )}
        </span>
      </div>

      <div className="ni-meter">
        <div className="ni-meter-track">
          {/* Tone drives the band, not the raw in-band check: `optimal` (and
              therefore a gold tone) can be true right at the band's edge,
              where float/clamp rounding can leave `inState` false — the band
              must still go fully gold whenever the marker does, or the two
              visibly disagree. */}
          <div
            className={`ni-meter-band ${tone === "gold" ? "is-in status-gold" : inState ? `is-in status-${tone}` : "is-off"}`}
          />
          {/* No gold "optimal slice" preview on the track: the band is all-green
              until the read itself earns gold, then it flips all-gold — the band
              states the verdict, it never advertises the range. */}
          <div
            className={`ni-meter-marker status-${tone}`}
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
  const nav = useNav();
  const toast = useToast();
  const readOnly = useIsReadOnly();
  const { config, setConfig } = useNutritionConfig();
  const [state, setState] = useState<NutritionStateFull | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [applying, setApplying] = useState(false);
  // Bumped by the Retry button to re-run the fetch effect (refreshKey is owned
  // by the parent; this is the card's own self-recovery trigger).
  const [errorNonce, setErrorNonce] = useState(0);
  const [freshTarget, setFreshTarget] = useState(false);
  // Last proposed target we rendered, so we can pulse only when it actually
  // changes — not on first load and not on every re-render.
  const prevProposedRef = useRef<number | null>(null);
  const seenRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    getNutritionState()
      .then((s) => {
        if (alive) {
          setState(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        // A failed fetch is NOT "no data yet" — surface it with a retry instead
        // of the misleading empty-state copy the card would otherwise show.
        if (alive) {
          setError(true);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [refreshKey, errorNonce]);

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
  const noData = loaded && !state && !error;

  // Persist an intake goal (same phase_deficits fifth-element write the
  // Settings sheet uses), refresh the shared config (Intake card's "/ target"
  // follows immediately), then recompute the evaluation so this card flips to
  // its post-change read (fresh target → daysOnTarget resets, confidence caps,
  // decision returns to a hold). Returns whether the write itself landed.
  async function persistIntakeGoal(intake: number): Promise<boolean> {
    const { defs } = phaseDefsFromConfig(config!);
    const updated = await saveConfig({ phase_deficits: [...defs, intake] as unknown as any });
    setConfig(updated);
    const fresh = await recomputeAndPersist().catch(() => null);
    if (fresh) setState(fresh);
    else setErrorNonce((n) => n + 1); // recompute failed — refetch what's persisted
    return true;
  }

  // Applying the recommendation is the user's explicit decision (the module
  // only evaluates; this tap is the policy change) — so per the app convention
  // it's optimistic + Undo toast, never a confirm dialog.
  async function applyTarget(proposed: number) {
    if (!config || applying) return;
    setApplying(true);
    const prevIntake = targetsFromConfig(config).calorieTarget;
    try {
      await persistIntakeGoal(proposed);
      toast(`Calorie target updated to ${proposed.toLocaleString()}`, "success", 5000, {
        label: "Undo",
        onClick: () => {
          void persistIntakeGoal(prevIntake)
            .then(() => toast(`Target restored to ${prevIntake.toLocaleString()}`, "info"))
            .catch(() => toast("Couldn’t restore the target — try again.", "error"));
        },
      });
    } catch {
      toast("Couldn’t update the target — try again.", "error");
    } finally {
      setApplying(false);
    }
  }

  // Fetch failed — keep the deep-link anchor (Overview jumps here) and offer a
  // retry, rather than masquerading as the "Not enough data yet" empty state.
  if (error && !state) {
    return (
      <ErrorState
        id="nutrition-insight-card"
        message="Couldn’t load your nutrition insight."
        onRetry={() => {
          setLoaded(false);
          setError(false);
          setErrorNonce((n) => n + 1);
        }}
      />
    );
  }

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
              {/* Static — the Hold target has no companion bar/ring, so per the
                  app rule it shows rather than counts up (only metered numbers roll). */}
              {decision.currentTarget.toLocaleString()}
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
            On this target{" "}
            <strong className="ni-conf-day">
              {d.daysOnTarget <= 0
                ? "today"
                : `${d.daysOnTarget} ${d.daysOnTarget === 1 ? "day" : "days"}`}
            </strong>
          </p>
        )}

        {/* Apply CTA — turns the proposal into the active target. Only rendered
            when there's an actual change to make (proposedTarget), never for
            viewers (read-only share) and never before config loads. */}
        {!loading && !readOnly && config && decision && decision.proposedTarget != null && (
          <button
            type="button"
            className="ni-apply"
            disabled={applying}
            onClick={() => void applyTarget(decision.proposedTarget!)}
          >
            {applying ? "Applying…" : `Apply ${decision.proposedTarget.toLocaleString()} kcal`}
          </button>
        )}
      </div>

      {/* Supporting numbers, grouped by the order a reader judges them. */}
      <div className="ni-evidence">
        {/* The comparison that drives the decision: Observed vs Target, paired. */}
        <div className="ni-group">
          {/* The pace verdict is derived from weight; its full trend (with the
              target-pace corridor) lives on Health's Weight card. The chevron
              deep-links there and asks it to open the corridor sheet on arrival
              (expand) rather than duplicating a sparkline here — only shown when
              there's an actual reading worth jumping to. */}
          <div className="ni-group-head">
            <span className="page-eyebrow" style={{ margin: 0 }}>Weight-loss pace</span>
            {!noData && !loading && hasTrend && hasRange && e && (
              <button
                type="button"
                className="ni-pace-open"
                aria-label="View weight trend in Health"
                onClick={() => nav("health", { scrollTo: "health-weight-card", expand: true })}
              >
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden>
                  <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          {!noData && !loading && hasTrend && hasRange && e ? (
            <PaceMeter
              observedRate={e.observedRate}
              lo={e.targetRange.min}
              hi={e.targetRange.max}
              accelDirection={e.accelDirection}
              optimal={paceTone(e) === "gold"}
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
          label="Est. intake 21d"
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
            "On this target · N days" line above now states plainly. A green dot
            marks High confidence (the reading is fully trustworthy); Low/Medium
            stay neutral, so the dot flags the good end rather than verdicting. */}
        <EvidenceCell
          label="Confidence"
          value={!noData && !loading ? (CONFIDENCE_LABEL[e!.confidence] ?? e!.confidence) : "—"}
          dot={!noData && !loading && e!.confidence === "high" ? "good" : undefined}
          emphasis="tertiary"
          full
        />
      </div>
    </section>
  );
}
