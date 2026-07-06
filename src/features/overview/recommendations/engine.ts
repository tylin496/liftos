// The Decision Engine — one unified brain over every domain's Evaluation.
//
// This is a precedence LADDER, not a leaderboard. The old model let each domain
// emit a recommendation with a `priority` number and picked the max; that can
// only ever surface single-domain advice, and resolves conflicts by whoever
// hand-tuned the bigger number. The directives this app actually wants are
// cross-domain *joint* verdicts — "losing too fast AND training's slipping →
// ease the deficit", "recovery great AND lifts rising → chase a PR" — which no
// independent-provider-max can express.
//
// So the ladder walks four tiers top-down and the FIRST one that fires wins,
// suppressing everything below it:
//
//   Tier 1  Protect     safety first — recovery debt / lean-mass loss
//   Tier 2  Correct      the plan needs a lever moved
//   Tier 3  Sustain      on plan — hold the line
//   Tier 4  Capitalize   everything's green — spend the headroom on a PR
//
// Each domain's Evaluation is first discretized into a small enum; the tiers
// read only those enums. Absence of data → "unknown", which never fires a
// bad-news tier (no info ≠ a problem). Wording is delegated to the domain
// providers where they already say it well (recovery, nutrition); the engine
// owns which tier fires, not the prose.

import type { RecContext, Recommendation } from "./types";
import type { RecoveryEvaluation } from "@features/health/math";
import type { TrainingEvaluation } from "@features/overview/strength";
import type { LeanMassEvaluation } from "@features/overview/goal";
import { recoveryProvider } from "./recovery";
import { nutritionProvider } from "./nutrition";

// ── Discretizers: raw evaluations → the enums the ladder reads ────────────────

type WeightState = "fast" | "on_pace" | "slow" | "stalled" | "unknown";

const STALLED_EPS = 0.1; // kg/week — |rate| below this reads as flat
const RATE_MARGIN = 0.15; // kg/week past a band edge before it materially counts

function weightState(n: RecContext["nutrition"]): WeightState {
  if (!n) return "unknown";
  const e = n.evaluation;
  // No active band (maintenance) or an unsettled trend can't drive a correction.
  if (e.targetRange.min === e.targetRange.max || e.confidence === "low") return "unknown";
  const loss = -e.observedRate; // observedRate is negative while losing
  if (Math.abs(e.observedRate) < STALLED_EPS) return "stalled";
  if (loss > e.targetRange.max + RATE_MARGIN) return "fast";
  if (loss < e.targetRange.min - RATE_MARGIN) return "slow";
  return "on_pace";
}

// Held the current target long enough to read as adherence, not a fresh change.
const ADHERENT_DAYS = 7;
function isAdherent(n: RecContext["nutrition"]): boolean {
  return !!n && n.diagnostics.daysOnTarget >= ADHERENT_DAYS;
}

type RecoveryState = "good" | "ok" | "poor" | "unknown";
function recoveryState(r: RecoveryEvaluation | null | undefined): RecoveryState {
  if (!r || r.status == null) return "unknown";
  if (r.status === "Needs Recovery") return "poor";
  if (r.status === "Fair") return "ok";
  return "good"; // Ready | Good
}

type TrainingState = "improving" | "holding" | "declining" | "unknown";
function trainingState(t: TrainingEvaluation | null | undefined): TrainingState {
  if (!t || t.confidence === "low") return "unknown";
  return t.trend;
}

function leanMassFalling(l: LeanMassEvaluation | null | undefined): boolean {
  return !!l && l.confidence === "high" && l.trend === "falling";
}

// ── The ladder ────────────────────────────────────────────────────────────────

export function decide(ctx: RecContext): Recommendation | null {
  const w = weightState(ctx.nutrition);
  const rec = recoveryState(ctx.recovery);
  const trn = trainingState(ctx.training);

  // ─ Tier 1 — Protect ────────────────────────────────────────────────────────
  // 1a Prioritize recovery. Fires on a settled readiness dip alone: low
  //    readiness is time-sensitive on its own, and gating it on a training
  //    decline too would keep us silent exactly when rest matters most. The
  //    recovery provider frames the action by recent training load.
  if (rec === "poor") {
    const r = recoveryProvider(ctx);
    if (r) return r;
  }
  // 1b Hold off on further cuts. Lean mass is genuinely sliding — the scariest
  //    call, so it only fires on a confident, sustained downslope.
  if (leanMassFalling(ctx.leanMass)) {
    return {
      source: "weight",
      priority: 80,
      title: "Hold off on further cuts",
      subtitle:
        "Lean mass has been trending down — pause the deficit and hold calories to protect muscle.",
    };
  }

  // ─ Tier 2 — Correct ─────────────────────────────────────────────────────────
  // 2a Reduce deficit. Losing too fast AND it's starting to cost training — the
  //    cross-domain read the ladder exists for. (Nutrition alone would flag the
  //    rate; naming the training slip is the point.)
  if (w === "fast" && trn === "declining") {
    return {
      source: "nutrition",
      priority: 71,
      title: "Reduce deficit slightly",
      subtitle:
        "You're losing faster than planned and training's starting to slip — ease the deficit to protect muscle.",
    };
  }
  // 2b Increase activity. Following the plan but the scale's stuck — reach for
  //    movement before cutting food further (calories are a budget, not the only
  //    lever). Deliberately overrides nutrition's own "cut more" reflex.
  if ((w === "stalled" || w === "slow") && isAdherent(ctx.nutrition)) {
    return {
      source: "weight",
      priority: 68,
      title: "Increase activity",
      subtitle:
        "You're on target but the scale's stalled — add activity rather than cutting calories further.",
    };
  }

  // ─ Tier 3 / 4 — Sustain vs Capitalize ───────────────────────────────────────
  // Nutrition's own decision is the default (maintain, or ease-the-deficit when
  // it's losing too fast without a training cost). But when nutrition has nothing
  // to change AND everything's green, surface the upside instead of a bland
  // "maintain" — the Capitalize tier is a *better* sustain, so it's checked here
  // rather than after the default (which would always pre-empt it).
  const nut = ctx.nutrition ? nutritionProvider(ctx) : null;
  const nutIdle = !nut || nut.title === "No action needed";
  if (nutIdle && rec === "good" && trn === "improving") {
    return {
      source: "training",
      priority: 50,
      title: "Push for a PR this week",
      subtitle:
        "Recovery's strong and your lifts are trending up — a good week to chase a PR.",
    };
  }

  return nut;
}
