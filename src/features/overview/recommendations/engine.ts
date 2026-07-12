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
//
// Hysteresis (anti-flip-flop): a weekly directive that flips as a signal wobbles
// at a threshold is worse than none. The inputs are already time-smoothed
// (weight 21d, recovery 7d-vs-30d, lean mass 30d), so the remaining risk is
// boundary chatter. We damp it with EXIT-stickiness keyed on the prior directive
// (passed in — it's already persisted, so no schema change): once a directive is
// showing, the signal must *clearly* clear before it drops (entry ≠ exit). Only
// the engine-owned corrections need this; nutrition's own directives already have
// nutritionDecision's confidence gate, and lean-mass/training are too slow to
// chatter.

import type { RecContext, Recommendation } from "./types";
import type { RecoveryEvaluation } from "@features/health/math";
import type { TrainingEvaluation } from "@features/overview/strength";
import type { LeanMassEvaluation } from "@features/overview/goal";
import { GOAL_EXIT_MARGIN_PP } from "@features/overview/goal";
import { recoveryRecommendation } from "./recovery";
import { nutritionProvider } from "./nutrition";

// Directive titles the hysteresis keys on (must match the strings produced below
// / by the recovery provider).
const RECOVERY_TITLE = "Prioritize recovery";
const REDUCE_DEFICIT_TITLE = "Reduce deficit slightly";
const INCREASE_ACTIVITY_TITLE = "Increase activity";
const START_MAINTENANCE_TITLE = "Start maintenance";
const CONSIDER_MAINTENANCE_TITLE = "Consider switching to maintenance";

// Phase policy — how many firing plateau triggers warrant the maintenance
// suggestion (enter), and how many keep it showing (hold). The triggers
// themselves are evaluation-only (phaseTriggers.ts reports what IS); the
// decision that "2 of 4 = act" lives here with the rest of the ladder's policy.
// Triggers are already multi-week smoothed, so residual chatter sits exactly at
// the 2↔1 boundary — an advisory directive errs sticky and releases at 0.
// Exported for the Journey card's Plan note, so the UI echoes the same gate it
// was decided with rather than hardcoding its own copy of the policy.
export const CONSIDER_ENTER_COUNT = 2;
const CONSIDER_HOLD_COUNT = 1;

// Recovery is held until readiness climbs back to at least "Good" (score ≥ 2),
// rather than dropping the instant it leaves "Needs Recovery" (score 0) for
// "Fair" (score 1).
const RECOVERY_RELEASE_SCORE = 2;

// ── Discretizers: raw evaluations → the enums the ladder reads ────────────────

type WeightState = "fast" | "on_pace" | "slow" | "stalled" | "unknown";

const STALLED_EPS = 0.1; // kg/week — |rate| below this reads as flat (enter)
const STALLED_EXIT_EPS = 0.15; // wider band to STAY stalled once flagged (exit)
const RATE_MARGIN = 0.15; // kg/week past a band edge before it counts (enter)
const RATE_EXIT_MARGIN = 0.05; // narrower margin to LEAVE a correction (exit)

function weightState(n: RecContext["nutrition"], priorTitle: string | null): WeightState {
  if (!n) return "unknown";
  const e = n.evaluation;
  // No active band (maintenance) or an unsettled trend can't drive a correction.
  if (e.targetRange.min === e.targetRange.max || e.confidence === "low") return "unknown";
  const loss = -e.observedRate; // observedRate is negative while losing
  // Schmitt hysteresis: a directive already showing uses a narrower exit margin,
  // so the rate must return well inside the band before the directive drops.
  const fastMargin = priorTitle === REDUCE_DEFICIT_TITLE ? RATE_EXIT_MARGIN : RATE_MARGIN;
  const heldStalled = priorTitle === INCREASE_ACTIVITY_TITLE;
  const slowMargin = heldStalled ? RATE_EXIT_MARGIN : RATE_MARGIN;
  const stalledEps = heldStalled ? STALLED_EXIT_EPS : STALLED_EPS;
  if (Math.abs(e.observedRate) < stalledEps) return "stalled";
  if (loss > e.targetRange.max + fastMargin) return "fast";
  if (loss < e.targetRange.min - slowMargin) return "slow";
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

// The maintenance directives only make sense while actually cutting. cutMode is
// derived from the live deficit (phaseFromDeficit) — once the user moves intake
// to maintenance, both rungs go quiet on the next evaluation. No nutrition
// slice → can't confirm a cut → don't fire (unknown never fires advice).
function isCutting(n: RecContext["nutrition"]): boolean {
  return !!n && n.diagnostics.cutMode !== "Maintenance";
}

// ── The ladder ────────────────────────────────────────────────────────────────

/** `prior` = the last-surfaced recommendation (persisted), used only for
 *  exit-hysteresis so a marginal wobble can't flip the directive. Omit it (or
 *  pass null) for a fresh, stateless verdict. */
export function decide(ctx: RecContext, prior?: Recommendation | null): Recommendation | null {
  const priorTitle = prior?.title ?? null;
  const w = weightState(ctx.nutrition, priorTitle);
  const trn = trainingState(ctx.training);
  const r = ctx.recovery;

  // ─ Tier 1 — Protect ────────────────────────────────────────────────────────
  // 1a Prioritize recovery. Fires on a settled readiness dip (Needs Recovery),
  //    or — with exit-hysteresis — while it was already showing and readiness
  //    hasn't climbed back to "Good" yet, so a one-night dip to "Fair" doesn't
  //    drop it. Recovery is time-sensitive on its own; no training decline
  //    required. Wording is framed by recent training load.
  const recFires =
    r?.status === "Needs Recovery" ||
    (priorTitle === RECOVERY_TITLE && r?.status != null && r.score < RECOVERY_RELEASE_SCORE);
  if (recFires && r) return recoveryRecommendation(r);

  // 1a′ Start maintenance. The cut's endpoint is reached (14-day body fat at or
  //     under target) — the plan says hold calories 4–6 weeks, then lean bulk.
  //     Below 1a (an acute recovery debt is this week's problem; the goal
  //     doesn't expire and re-fires next evaluation) but above 1b: both say
  //     "stop the deficit", and at goal "Start maintenance" is the same action
  //     with the complete frame. Exit-hysteresis: once showing, it holds until
  //     the 14-day average drifts back above target + margin, so a boundary
  //     wobble can't flip it to "Consider".
  const g = ctx.goal;
  const goalFires =
    isCutting(ctx.nutrition) &&
    g != null &&
    (g.reached ||
      (priorTitle === START_MAINTENANCE_TITLE &&
        g.bodyFat14dAvg != null &&
        g.targetBodyFatPct != null &&
        g.bodyFat14dAvg <= g.targetBodyFatPct + GOAL_EXIT_MARGIN_PP));
  if (goalFires) {
    return {
      source: "phase",
      priority: 78,
      title: START_MAINTENANCE_TITLE,
      subtitle: `Body fat has reached your ${g.targetBodyFatPct}% goal — hold calories at maintenance for 4–6 weeks before the lean bulk`,
    };
  }

  // 1b Hold off on further cuts. Lean mass is genuinely sliding — the scariest
  //    call, so it only fires on a confident, sustained downslope.
  if (leanMassFalling(ctx.leanMass)) {
    return {
      source: "weight",
      priority: 80,
      title: "Hold off on further cuts",
      subtitle:
        "Lean mass has been trending down — pause the deficit and hold calories to protect muscle",
    };
  }

  // ─ Tier 2 — Correct ─────────────────────────────────────────────────────────
  // 2-pre Consider switching to maintenance. Enough independent plateau signals
  //    (weight stall / strength decline / recovery / adherence) are on at once
  //    that a planned 4–6 week maintenance block beats grinding the cut. Top of
  //    Tier 2 deliberately: it must outrank 2b — when a 3-week stall and
  //    worsening recovery fire together, "add activity" is the wrong
  //    prescription for a fatigued dieter — but it stays below Tier 1 because
  //    it's advisory, not protective. At goal, 1a′ pre-empts this rung, so the
  //    user is never told to "consider" what they should simply start.
  const p = ctx.phase;
  const considerFires =
    isCutting(ctx.nutrition) &&
    p != null &&
    (p.firingCount >= CONSIDER_ENTER_COUNT ||
      (priorTitle === CONSIDER_MAINTENANCE_TITLE && p.firingCount >= CONSIDER_HOLD_COUNT));
  if (considerFires) {
    const n = p.firingCount;
    return {
      source: "phase",
      priority: 72,
      title: CONSIDER_MAINTENANCE_TITLE,
      subtitle: `${n} of ${p.triggers.length} plateau signal${n === 1 ? " is" : "s are"} on — a 4–6 week maintenance block would consolidate before pushing further`,
    };
  }

  // 2a Reduce deficit. Losing too fast AND it's starting to cost training — the
  //    cross-domain read the ladder exists for. (Nutrition alone would flag the
  //    rate; naming the training slip is the point.)
  if (w === "fast" && trn === "declining") {
    return {
      source: "nutrition",
      priority: 71,
      title: REDUCE_DEFICIT_TITLE,
      subtitle:
        "You're losing faster than planned and training's starting to slip — ease the deficit to protect muscle",
    };
  }
  // 2b Increase activity. Following the plan but the scale's stuck — reach for
  //    movement before cutting food further (calories are a budget, not the only
  //    lever). Deliberately overrides nutrition's own "cut more" reflex.
  if ((w === "stalled" || w === "slow") && isAdherent(ctx.nutrition)) {
    return {
      source: "weight",
      priority: 68,
      title: INCREASE_ACTIVITY_TITLE,
      subtitle:
        "You're on target but the scale's stalled — add activity rather than cutting calories further",
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
  if (nutIdle && recoveryState(r) === "good" && trn === "improving") {
    return {
      source: "training",
      priority: 50,
      title: "Push for a PR this week",
      subtitle:
        "Recovery's strong and your lifts are trending up — a good week to chase a PR",
    };
  }

  return nut;
}
