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
import { phaseDirection } from "@features/nutrition/logic";
import { KCAL_PER_KG } from "@features/nutrition/evaluation";
import { recoveryRecommendation, RECOVERY_TITLE } from "./recovery";
import { NO_ACTION_TITLE } from "@features/nutrition/recommendation";
import { nutritionProvider } from "./nutrition";
// nutrition's own "Review calorie target" (reduce) is the slow-side correction the
// engine defers to when strength is safe — keep the title here so the hysteresis keys
// on the same string nutritionDecision emits (eventType).
export const REVIEW_TARGET_TITLE = "Review calorie target";

// Directive titles the hysteresis keys on. RECOVERY_TITLE is owned by recovery.ts
// (where the directive is produced) and imported so the two can't drift; the rest
// are produced inline in this file, so their constant and producer are co-located.
// Exported where Overview's System banner deep-links the directive to a specific
// card (REC_ANCHOR) — the title is the directive's identity, so the banner and the
// ladder can't drift apart on a string.
export const REDUCE_DEFICIT_TITLE = "Reduce deficit slightly";
export const HOLD_CUTS_TITLE = "Hold off on further cuts";
export const INCREASE_ACTIVITY_TITLE = "Increase activity";
const HIT_TARGET_TITLE = "Hit your current target";
export const START_MAINTENANCE_TITLE = "Start maintenance";
export const CONSIDER_MAINTENANCE_TITLE = "Consider switching to maintenance";
// Bulk mirrors — same ladder positions as their cut counterparts, gated on
// isBulking instead of isCutting (mutually exclusive by phase).
export const START_CUT_TITLE = "Start the cut";
export const CONSIDER_BREAK_TITLE = "Consider a maintenance break";
export const REDUCE_SURPLUS_TITLE = "Reduce surplus";

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
// …but the *cause* of the dip changes how sticky the exit should be, and recent
// training load is the only thing that distinguishes them. A dip that follows
// real training is expected, transient fatigue — a deload day fixes it, so let
// it release a step earlier (once it reaches "Fair"). A dip with little recent
// training is systemic (sleep/life stress) and won't self-resolve, so hold the
// directive until readiness is fully back ("Ready", score 3). Entry is
// unchanged — this only tunes how long the directive lingers on the way out.
const RECOVERY_RELEASE_TRAINING_STRESS = 1;
const RECOVERY_RELEASE_SYSTEMIC = 3;
function recoveryReleaseScore(load: RecoveryEvaluation["trainingLoad"]): number {
  if (load === "trained") return RECOVERY_RELEASE_TRAINING_STRESS;
  if (load === "rested") return RECOVERY_RELEASE_SYSTEMIC;
  return RECOVERY_RELEASE_SCORE; // no exercise data → can't attribute, use the default
}

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
  // Progress in the phase direction: the loss on a cut, the gain on a bulk —
  // so "fast" always means "moving faster than the plan", whichever way.
  const progress = phaseDirection(e.phaseKind) * e.observedRate;
  // Schmitt hysteresis: a directive already showing uses a narrower exit margin,
  // so the rate must return well inside the band before the directive drops. A held
  // "Review calorie target" (nutrition's own reduce/increase) counts as a shown
  // correction on both edges — the slow-side lever now surfaces under that title, and
  // its eventType doesn't encode direction — so it's treated as sticky either way.
  const heldReview = priorTitle === REVIEW_TARGET_TITLE;
  const fastMargin =
    priorTitle === REDUCE_DEFICIT_TITLE || priorTitle === REDUCE_SURPLUS_TITLE || heldReview
      ? RATE_EXIT_MARGIN
      : RATE_MARGIN;
  const heldStalled = priorTitle === INCREASE_ACTIVITY_TITLE || heldReview;
  const slowMargin = heldStalled ? RATE_EXIT_MARGIN : RATE_MARGIN;
  const stalledEps = heldStalled ? STALLED_EXIT_EPS : STALLED_EPS;
  if (Math.abs(e.observedRate) < stalledEps) return "stalled";
  if (progress > e.targetRange.max + fastMargin) return "fast";
  if (progress < e.targetRange.min - slowMargin) return "slow";
  return "on_pace";
}

// ── Adherence: is the plan actually being followed? ───────────────────────────
// `daysOnTarget` is a much narrower fact than its name suggests — it counts the
// trailing days the calorie_target FIELD has held its current value. It says the
// plan is settled (not freshly changed, so the scale's read isn't a post-change
// water transient); it says nothing whatsoever about what was eaten. On its own it
// would let "target set three weeks ago, +400 kcal/day every day since" read as
// adherent, and the stall rung would then assert "you're on target" — a fact it
// never checked — before prescribing a lever aimed at the wrong problem.
//
// So the food log gets a veto, and only a veto. The asymmetry is forced by what the
// log is: a systematic UNDER-count (nobody logs the oil in the pan), roughly
// constant — see the imprecise-logs principle the reduce lever is built on. Read
// against a target that makes it:
//   • logged clearly ABOVE target → conclusive. The true intake is higher still, so
//     the plan is definitely not being followed. Revokes adherence.
//   • logged at/below target → inconclusive. Could be adherence, could be the
//     offset. It cannot MANUFACTURE the adherence claim, only fail to deny it.
//   • no log at all → no evidence either way; unchanged behaviour (a non-logger
//     keeps the muscle guardrail, per "no data → no bad news").
const ADHERENT_DAYS = 7;

// How far above target the logged mean must sit before it overrules the plan.
// Sized to the question being asked: the smallest sustained daily overshoot that
// could itself explain the stall the rung is reacting to — STALLED_EPS (0.1 kg/wk)
// of unrealised progress ≈ 110 kcal/day. Under that, the gap is inside the log's
// own precision and explains nothing.
const OFF_PLAN_KCAL = (STALLED_EPS * KCAL_PER_KG) / 7;

/** Logged intake deviating from the target in the direction that would explain a
 *  stall — eating ABOVE target on a cut, BELOW it on a bulk — by enough to matter.
 *  Returns the daily kcal magnitude, or 0 when the log is absent or doesn't
 *  clear the margin. Phase-agnostic by construction: the same "against the plan"
 *  polarity every other verdict in this file reads. */
function loggedOffPlan(n: RecContext["nutrition"]): number {
  if (!n) return 0;
  const { loggedIntake, calorieTarget } = n.diagnostics;
  if (loggedIntake == null) return 0;
  // phaseDirection is −1 on a cut / +1 on a bulk (the sign of "progress" on the
  // scale), so negating it gives the sign of "over-eating relative to the plan".
  const against = (loggedIntake - calorieTarget) * -phaseDirection(n.evaluation.phaseKind);
  return against > OFF_PLAN_KCAL ? against : 0;
}

function isAdherent(n: RecContext["nutrition"]): boolean {
  return !!n && n.diagnostics.daysOnTarget >= ADHERENT_DAYS && loggedOffPlan(n) === 0;
}

type RecoveryState = "good" | "ok" | "poor" | "unknown";
// Discretization per DECISION-ENGINE.md §狀態離散化: GOOD = score 3 (Ready),
// OK = score 2 (Good), POOR = score ≤1 (Fair | Needs Recovery). Tier 4's
// "everything green" gate needs GOOD — a score-2 "Good" (one marker off
// baseline) is NOT fully green and must read as "ok", or the PR push fires
// before recovery is actually clear.
function recoveryState(r: RecoveryEvaluation | null | undefined): RecoveryState {
  if (!r || r.status == null) return "unknown";
  if (r.status === "Ready") return "good"; // score 3
  if (r.status === "Good") return "ok"; // score 2 — one marker down, not fully green
  return "poor"; // Fair (1) | Needs Recovery (0)
}

type TrainingState = "improving" | "holding" | "declining" | "unknown";
function trainingState(t: TrainingEvaluation | null | undefined): TrainingState {
  if (!t || t.confidence === "low") return "unknown";
  return t.trend;
}

function leanMassFalling(l: LeanMassEvaluation | null | undefined): boolean {
  return !!l && l.confidence === "high" && l.trend === "falling";
}

// The phase directives only make sense in their own phase. The kind is derived
// from the live deficit (phaseFromDeficit → phaseKindFromName) — once the user
// moves intake, the rungs re-gate on the next evaluation. No nutrition slice →
// can't confirm a phase → don't fire (unknown never fires advice). Kind-based
// on purpose: the old `cutMode !== "Maintenance"` check would have counted a
// Lean Bulk as "cutting".
function isCutting(n: RecContext["nutrition"]): boolean {
  return !!n && n.evaluation.phaseKind === "cut";
}
function isBulking(n: RecContext["nutrition"]): boolean {
  return !!n && n.evaluation.phaseKind === "bulk";
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
  // A user dismiss suppresses the recovery rung entirely (they know the cause —
  // sick/travel — see recomputeAndPersist for the snooze + auto-clear). The
  // ladder falls through to the next tier as if recovery had nothing to say.
  const recFires =
    !ctx.recoveryDismissed &&
    (r?.status === "Needs Recovery" ||
      (priorTitle === RECOVERY_TITLE && r?.status != null && r.score < recoveryReleaseScore(r.trainingLoad)));
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

  // 1a″ Start the cut — the bulk mirror of 1a′. The lean bulk's endpoint is
  //     reached (14-day body fat at or above the configured ceiling): the fat
  //     budget is spent, so the next phase starts. Same ladder position, same
  //     mirrored exit-hysteresis (holds until bf14 clears ceiling − margin), and
  //     mutually exclusive with 1a′ via the phase gate.
  const bg = ctx.bulkGoal;
  const bulkGoalFires =
    isBulking(ctx.nutrition) &&
    bg != null &&
    (bg.reached ||
      (priorTitle === START_CUT_TITLE &&
        bg.bodyFat14dAvg != null &&
        bg.bfCeilingPct != null &&
        bg.bodyFat14dAvg >= bg.bfCeilingPct - GOAL_EXIT_MARGIN_PP));
  if (bulkGoalFires) {
    return {
      source: "phase",
      priority: 78,
      title: START_CUT_TITLE,
      subtitle: `Body fat has reached your ${bg.bfCeilingPct}% ceiling — the bulk's fat budget is spent, time to cut back down`,
    };
  }

  // 1b Hold off on further cuts. Lean mass is genuinely sliding — the scariest
  //    call, so it only fires on a confident, sustained downslope. Gated on
  //    isCutting: its action is "pause the deficit", which is meaningless in
  //    maintenance (no deficit to pause) — like 1a′/2-pre, this rung is a
  //    cut-only directive.
  if (isCutting(ctx.nutrition) && leanMassFalling(ctx.leanMass)) {
    return {
      source: "weight",
      priority: 80,
      title: HOLD_CUTS_TITLE,
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

  // 2-pre-bulk Consider a maintenance break — the bulk mirror. The same four
  //    plateau signals stacking up mid-bulk (scale flat, lifts sliding, recovery
  //    low, plan slipping) say the surplus isn't being turned into progress —
  //    a hold beats force-feeding through it. Same enter/hold counts.
  const breakFires =
    isBulking(ctx.nutrition) &&
    p != null &&
    (p.firingCount >= CONSIDER_ENTER_COUNT ||
      (priorTitle === CONSIDER_BREAK_TITLE && p.firingCount >= CONSIDER_HOLD_COUNT));
  if (breakFires) {
    const n = p.firingCount;
    return {
      source: "phase",
      priority: 72,
      title: CONSIDER_BREAK_TITLE,
      subtitle: `${n} of ${p.triggers.length} plateau signal${n === 1 ? " is" : "s are"} on — the surplus isn't landing as progress; a maintenance hold would reset before pushing on`,
    };
  }

  // 2a Reduce deficit. Losing too fast AND it's starting to cost training — the
  //    cross-domain read the ladder exists for. (Nutrition alone would flag the
  //    rate; naming the training slip is the point.) Spec's second trigger is
  //    "Weight=FAST AND (Training=DECLINING OR Recovery=POOR)"; the recovery arm
  //    is scoped to a settled "Needs Recovery" (the only recovery state the
  //    engine treats as a real problem — Fair never fires 1a and lacks the
  //    persistence spec's POOR requires). Normally 1a pre-empts it; this arm
  //    only bites once recovery is dismissed, closing the hole where a fast cut
  //    on a fatigued (but snoozed) dieter fell through to a bland nutrition read.
  const recoveryPoor = r?.status === "Needs Recovery";
  if (isCutting(ctx.nutrition) && w === "fast" && (trn === "declining" || recoveryPoor)) {
    return {
      source: "nutrition",
      priority: 71,
      title: REDUCE_DEFICIT_TITLE,
      subtitle:
        "You're losing faster than planned and training's starting to slip — ease the deficit to protect muscle",
    };
  }

  // 2a-bulk Reduce surplus. Gaining faster than the band AND the gain shows a
  //    cost — body fat confidently climbing or training sliding — or lean mass
  //    is confidently FALLING while the scale rises (the gain isn't lean at
  //    all). Evidence-gated like 2a: a fast week alone falls through to
  //    nutrition's own high-confidence reduce, which needs the settled trend.
  const bfRising = ctx.bodyFatTrend?.confidence === "high" && ctx.bodyFatTrend.trend === "rising";
  const gainNotLean = leanMassFalling(ctx.leanMass) && (w === "fast" || w === "on_pace");
  if (isBulking(ctx.nutrition) && ((w === "fast" && (bfRising || trn === "declining")) || gainNotLean)) {
    return {
      source: "nutrition",
      priority: 71,
      title: REDUCE_SURPLUS_TITLE,
      subtitle: gainNotLean
        ? "The scale is climbing but lean mass isn't — trim the surplus; the extra calories aren't building muscle"
        : bfRising
          ? "You're gaining faster than planned and body fat is climbing — trim the surplus to keep the gain lean"
          : "You're gaining faster than planned while training slips — trim the surplus; more food isn't helping",
    };
  }
  // The scale isn't moving the way the plan says it should. Every rung below
  // answers that same fact; they differ only in which lever is honest to pull.
  const stalling = w === "stalled" || w === "slow";

  // 2b-pre Hit your current target. Before touching ANY lever, check the plan is
  //    actually being run: when the food log says intake has been sitting against
  //    the plan (over on a cut / under on a bulk) by enough to explain the stall,
  //    the target isn't what's wrong. Moving it would be answering a question
  //    nobody asked — a lower target you don't follow is just a bigger gap, and
  //    "add activity" prescribes work to offset food you could simply not eat.
  //    Fires on the log's positive evidence only (see loggedOffPlan), so a
  //    non-logger never sees it. No hysteresis needed: the input is a 21-day mean
  //    against a fixed number, already smoother than anything that chatters.
  const offPlan = loggedOffPlan(ctx.nutrition);
  if (stalling && offPlan > 0 && (isCutting(ctx.nutrition) || isBulking(ctx.nutrition))) {
    // Rounded to 50 — the log is a rough instrument (a systematic under-count),
    // and quoting it to the kcal would claim a precision it doesn't have.
    const gap = Math.round(offPlan / 50) * 50;
    return {
      source: "nutrition",
      priority: 70,
      title: HIT_TARGET_TITLE,
      subtitle: isCutting(ctx.nutrition)
        ? `Your food log is averaging about ${gap} kcal/day over target — the target isn't the problem yet, so close that gap before changing it`
        : `Your food log is averaging about ${gap} kcal/day under target — the surplus is on paper only, so hit the target you already have before raising it`,
    };
  }

  // 2b Genuinely slow / stalled while adherent — the scale isn't moving enough.
  //    Lowering the target is a valid lever ONLY when strength is clearly safe:
  //    deepening the deficit trades muscle for speed, and for a hypertrophy-minded
  //    lifter that's usually a bad trade. So the DEFAULT is to add activity (or hold)
  //    rather than cut, and we fall through to nutrition's own reduce ONLY when the
  //    lifts confirm there's room — training present, not low-confidence, not
  //    declining, and no lift needing intervention. Absent/soft strength data → stay
  //    conservative and don't cut. (Being at the band FLOOR is NOT a trigger — that's
  //    often the safest pace; the deceleration is already shown by the Weight card's
  //    accel arrow.)
  // Cut-only: on a bulk a stalled scale means the surplus is too SMALL — adding
  // activity would make it smaller still, so the bulk's slow-side lever is
  // nutritionDecision's own "Increase calorie target" (the default below).
  const wantsTighten = isCutting(ctx.nutrition) && stalling && isAdherent(ctx.nutrition);
  if (wantsTighten) {
    // Divert to activity (don't cut) on POSITIVE evidence the lifts are softening —
    // a declining trend OR a lift that actually needs intervention. Absent/low-
    // confidence training = no evidence, so we don't block the cut (no data → no
    // bad news).
    //
    // `attention`, NOT `watch`. `watch` is every lift under 94% of its PR, which in
    // a healthy block is chronically non-empty: a lift fresh off a PR sits below it,
    // a rebounding lift sits below it, and a `settled` one sits below it by
    // definition — that flag exists precisely to stop 12-week-old stalls from being
    // re-litigated every week. Gating on `watch` therefore makes the guardrail
    // unconditional for anyone with a dozen lifts: the deficit could never be
    // deepened, and nutrition's own lever would be permanently unreachable.
    // buildTrainingEvaluation already rejected `watch` for exactly this reason when
    // it computes `trend` — reading it here was the engine taking the version that
    // module overruled. `attention` is the predicate `trend` is built from, so the
    // two now agree by construction.
    const t = ctx.training;
    const strengthSoftening = t != null && t.confidence !== "low" && (t.trend === "declining" || t.attention > 0);
    if (strengthSoftening) {
      return {
        source: "weight",
        priority: 68,
        title: INCREASE_ACTIVITY_TITLE,
        // Says only what's been verified: the target has held for weeks (daysOnTarget)
        // and the log hasn't contradicted it. It does NOT claim the eating was on
        // target — nothing here can prove that (the log only ever disproves it).
        subtitle:
          "The scale's stalled and your target hasn't moved in weeks — add activity before cutting calories further, so you protect strength while your lifts are under strain",
      };
    }
    // Lifts show no strain → fall through to nutrition's own reduce (below).
  }

  // ─ Tier 3 / 4 — Sustain vs Capitalize ───────────────────────────────────────
  // Nutrition's own decision is the default (maintain, or ease-the-deficit when
  // it's losing too fast without a training cost). But when nutrition has nothing
  // to change AND everything's green, surface the upside instead of a bland
  // "maintain" — the Capitalize tier is a *better* sustain, so it's checked here
  // rather than after the default (which would always pre-empt it).
  const nut = ctx.nutrition ? nutritionProvider(ctx) : null;
  const nutIdle = !nut || nut.title === NO_ACTION_TITLE;
  if (nutIdle && recoveryState(r) === "good" && trn === "improving" && ctx.training?.leader) {
    const t = ctx.training;
    const leader = t.leader!;
    // Capitalize earns a card ONLY when there's a *named* target to beat: a single
    // lift climbing steadily with room left (the literal claim pickLeader verifies —
    // consecutive submaximal steps + no set collapse). Then "add weight" points at a
    // specific lift AND a specific number — a decision the user can't already hold in
    // their head. Without a leader, the honest directive collapses to "add a rep to a
    // top set", which is just progressive overload — what a lifter on a plan already
    // does by default. That's confirmation, not a recommendation, so it earns no slot:
    // fall through to nutrition's quiet sustain rather than manufacture an action out
    // of "everything's green". The concrete count still carries the copy that DOES fire.
    const atBest =
      t.improving > 0 ? `${t.improving} of ${t.total} lifts at their best` : "your lifts are trending up";
    return {
      source: "training",
      priority: 50,
      title: `Push ${leader.name} past ${leader.detail}`,
      subtitle: `Recovery's fully back and ${atBest} — ${leader.name}'s climbing steadily with room left, so make your next session the one to beat your ${leader.detail}`,
    };
  }

  return nut;
}
