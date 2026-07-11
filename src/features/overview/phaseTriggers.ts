// Phase Triggers — the upstream "consider maintenance early?" monitor.
//
// The user's long-term plan is Cut → Maintenance (4–6 wk at goal body fat) →
// Lean Bulk, with an early-exit rule: when enough independent plateau signals
// stack up, a maintenance block beats grinding the cut. This module computes
// those signals ONCE, and both consumers read the same result:
//
//   evaluatePhaseTriggers() ── Journey card (trigger lights)
//                           └─ Decision Engine (RecContext.phase → directive)
//
// The engine never re-derives a trigger, and the card never re-derives what the
// engine saw. Goal-reached ("body fat at target") is deliberately NOT a trigger
// — it's a goal judgment and lives in goal.ts (buildGoalStatus); this module
// only answers "is the cut degrading?".
//
// Evaluation only, never policy: this module reports what IS (which signals
// fire, how many). Whether that warrants a directive — the ≥N gate, the
// hysteresis, the wording — belongs to the Decision Engine.
//
// Every trigger is three-state: firing / ok / unknown. Missing or thin data is
// ALWAYS unknown, and unknown never fires — same "unknown never fires bad news"
// principle the engine's discretizers follow.

import type { BodyMetric } from "@features/health/api";
import { series, theilSenSlope, computeRecovery } from "@features/health/math";
import { getCalorieResult, DEFAULTS } from "@features/nutrition/logic";
import { WINDOW_DAYS } from "@features/nutrition/evaluation";
import type { StrengthSummary } from "./strength";

export type TriggerKey = "weight_stall" | "strength_decline" | "recovery_worsening" | "adherence_slipping";
export type TriggerState = "firing" | "ok" | "unknown";

export interface PhaseTrigger {
  key: TriggerKey;
  /** Short chip label, fixed per key. */
  label: string;
  state: TriggerState;
  /** One-line evidence for the chip tooltip/subline — states WHY, in data. */
  detail: string;
}

/** The per-day nutrition row the adherence trigger reads — each day judged
 *  against its OWN persisted budget snapshot, not today's config. */
export interface PhaseTriggerEntry {
  entry_date: string;
  calories: number | null;
  tdee: number | null;
  deficit_target: number | null;
}

export interface PhaseTriggerInputs {
  /** Health metrics ascending by date. Callers pass different spans (engine 90d,
   *  overview 180d) — every lookback here is ≤ ~45d, so both agree. */
  metrics: BodyMetric[];
  strength: StrengthSummary | null;
  /** StrengthExercise carries no compound flag, so the slug set rides alongside. */
  compoundSlugs: Set<string>;
  entries: PhaseTriggerEntry[];
  /** Local calendar date anchoring the adherence window — keeps the module
   *  now-free (all other triggers anchor on their own data's latest date). */
  today: string;
}

export interface PhaseTriggerResult {
  /** Always all four, fixed order — the card renders them positionally. */
  triggers: PhaseTrigger[];
  firingCount: number;
}

// ── Thresholds (single source — the engine imports its gates from here) ──────

/** Weekly-rate checkpoints, days back from the latest weigh-in. Three flat
 *  21-day windows a week apart ≈ "stalled for three straight weeks". */
export const STALL_CHECKPOINT_OFFSETS = [0, 7, 14] as const;
/** kg/wk under which a trend reads flat — matches the engine's STALLED_EPS so
 *  the trigger and the ladder's instantaneous "stalled" can never disagree. */
export const STALL_RATE_EPS = 0.1;

/** A declining lift only counts once its trajectory confidence clears this.
 *  Confidence = cadence × (0.5 + 0.5·sample): a fortnightly-or-better lift with
 *  ≥3 sessions reads ≥0.75, one logged 3× in 6 weeks ~0.5 — so 0.6 admits
 *  normally-programmed lifts and excludes exactly the sparse windows where a
 *  two-step slide is scheduling noise, not regression. */
export const DECLINE_MIN_CONFIDENCE = 0.6;
/** Simultaneous confident compound declines before the trigger fires. */
export const DECLINE_MIN_LIFTS = 2;

/** Recovery-score checkpoints, days back from the latest metric. */
export const RECOVERY_CHECKPOINT_OFFSETS = [0, 7, 14] as const;
/** Score at or under this = a low week (Fair / Needs Recovery). */
export const RECOVERY_LOW_SCORE = 1;

/** Adherence window: the "recently" in "recently eating over budget". */
export const ADHERENCE_WINDOW_DAYS = 14;
/** Over/surplus days in the window before it's a pattern, not a party. The
 *  on-plan band is already ±25% forgiving, so each miss is real; 4+ in a
 *  fortnight ≈ two bad weekends, while 3 can be one weekend plus a dinner. */
export const ADHERENCE_OVER_DAYS = 4;
/** Logged days needed before the window can tell pattern from coincidence. */
export const ADHERENCE_MIN_LOGGED = 7;

// ── Helpers ──────────────────────────────────────────────────────────────────

const dateMinusDays = (iso: string, days: number): string => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Over-budget days among the LOGGED days of the trailing window. Each day is
 *  judged against its own persisted tdee/deficit snapshot via the same per-day
 *  primitive the Today card uses (getCalorieResult), so this can never disagree
 *  with the day's own verdict: over/surplus = a miss, low-intake is NOT a miss,
 *  and an unlogged day carries no verdict at all. */
export function countOverBudgetDays(
  entries: PhaseTriggerEntry[],
  today: string,
  windowDays: number = ADHERENCE_WINDOW_DAYS,
): { over: number; logged: number } {
  const from = dateMinusDays(today, windowDays - 1);
  let over = 0;
  let logged = 0;
  for (const e of entries) {
    if (e.entry_date < from || e.entry_date > today || e.calories == null) continue;
    logged++;
    const { state } = getCalorieResult(
      e.calories,
      e.tdee ?? DEFAULTS.tdee,
      e.deficit_target ?? DEFAULTS.deficitTarget,
    );
    if (state === "over" || state === "surplus") over++;
  }
  return { over, logged };
}

// ── The four triggers ────────────────────────────────────────────────────────

/** T1 — weight stalled ≥3 weeks. The engine's "stalled" is instantaneous (one
 *  21-day Theil–Sen window); this replays that same window at weekly checkpoints
 *  stepping back from the latest weigh-in. All three flat → a real plateau, not
 *  a slow week. Data-anchored and now-free, like theilSenSlope itself. */
function weightStallTrigger(metrics: BodyMetric[]): PhaseTrigger {
  // Labels are neutral metric names, not problem names — the lights read
  // green-when-fine, so "Weight trend" (not "Weight stall") is what's green.
  const label = "Weight trend";
  const pts = series(metrics, "weight_kg");
  const latest = pts.at(-1)?.date;
  if (!latest) return { key: "weight_stall", label, state: "unknown", detail: "No weigh-ins yet" };

  const slopes: number[] = [];
  for (const offset of STALL_CHECKPOINT_OFFSETS) {
    const cutoff = dateMinusDays(latest, offset);
    const slope = theilSenSlope(pts.filter((p) => p.date <= cutoff), WINDOW_DAYS);
    if (slope == null) return { key: "weight_stall", label, state: "unknown", detail: "Not enough weigh-ins" };
    slopes.push(slope);
  }

  if (slopes.every((s) => Math.abs(s) < STALL_RATE_EPS)) {
    return { key: "weight_stall", label, state: "firing", detail: "Flat for 3+ weeks" };
  }
  const now = slopes[0];
  return {
    key: "weight_stall",
    label,
    state: "ok",
    detail: `Trending ${now < 0 ? "−" : "+"}${Math.abs(now).toFixed(1)} kg/wk`,
  };
}

/** T2 — ≥2 compound lifts confidently declining at once. One lift sliding is a
 *  bad fortnight; two big lifts sliding together during a cut is the systemic
 *  signal. Low-confidence trajectories (sparse logging) never count. */
function strengthDeclineTrigger(strength: StrengthSummary | null, compoundSlugs: Set<string>): PhaseTrigger {
  const label = "Strength";
  const compounds = strength?.exercises.filter((e) => compoundSlugs.has(e.slug)) ?? [];
  if (compounds.length < DECLINE_MIN_LIFTS) {
    return { key: "strength_decline", label, state: "unknown", detail: "Not enough lift data" };
  }
  const declining = compounds.filter(
    (e) => e.trajectory.direction === "declining" && e.trajectory.confidence >= DECLINE_MIN_CONFIDENCE,
  );
  if (declining.length >= DECLINE_MIN_LIFTS) {
    return {
      key: "strength_decline",
      label,
      state: "firing",
      detail: `${declining.map((e) => e.name).slice(0, 3).join(", ")} declining`,
    };
  }
  return {
    key: "strength_decline",
    label,
    state: "ok",
    detail: declining.length === 1 ? `Only ${declining[0].name} declining` : "Compound lifts holding",
  };
}

/** T3 — recovery persistently low. computeRecovery is data-anchored (its
 *  windows key off the slice's own latest reading), so replaying it on
 *  truncated metrics gives true historical snapshots. Firing = low at both of
 *  the last two weekly checkpoints AND not better than two weeks ago — catches
 *  "slid and stayed" and "chronically low", rejects one bad week and visible
 *  rebounds. The wall-clock stale flag is only meaningful on the now-slice
 *  (offset 0); stale-now → unknown, mirroring buildRecoveryEvaluation. */
function recoveryWorseningTrigger(metrics: BodyMetric[]): PhaseTrigger {
  const label = "Recovery";
  const latest = metrics.at(-1)?.metric_date;
  if (!latest) return { key: "recovery_worsening", label, state: "unknown", detail: "No recovery data" };

  const scores: number[] = [];
  for (const offset of RECOVERY_CHECKPOINT_OFFSETS) {
    const cutoff = dateMinusDays(latest, offset);
    const snap = computeRecovery(metrics.filter((m) => m.metric_date <= cutoff));
    if (snap.status == null || (offset === 0 && snap.stale)) {
      return { key: "recovery_worsening", label, state: "unknown", detail: "Not enough recovery data" };
    }
    scores.push(snap.score);
  }

  const [s0, s7, s14] = scores;
  if (s0 <= RECOVERY_LOW_SCORE && s7 <= RECOVERY_LOW_SCORE && s0 <= s14) {
    return { key: "recovery_worsening", label, state: "firing", detail: "Low for 2+ weeks" };
  }
  return { key: "recovery_worsening", label, state: "ok", detail: `Score ${s0}/3 this week` };
}

/** T4 — the diet is getting hard to hold: too many over-budget days recently. */
function adherenceTrigger(entries: PhaseTriggerEntry[], today: string): PhaseTrigger {
  const label = "Adherence";
  const { over, logged } = countOverBudgetDays(entries, today);
  if (logged < ADHERENCE_MIN_LOGGED) {
    return { key: "adherence_slipping", label, state: "unknown", detail: "Too few logged days" };
  }
  return {
    key: "adherence_slipping",
    label,
    state: over >= ADHERENCE_OVER_DAYS ? "firing" : "ok",
    detail: `${over} over-budget day${over === 1 ? "" : "s"} in ${ADHERENCE_WINDOW_DAYS}`,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function evaluatePhaseTriggers(inputs: PhaseTriggerInputs): PhaseTriggerResult {
  const triggers: PhaseTrigger[] = [
    weightStallTrigger(inputs.metrics),
    strengthDeclineTrigger(inputs.strength, inputs.compoundSlugs),
    recoveryWorseningTrigger(inputs.metrics),
    adherenceTrigger(inputs.entries, inputs.today),
  ];
  return { triggers, firingCount: triggers.filter((t) => t.state === "firing").length };
}
