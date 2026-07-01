// Primary Goal — the upstream Provider.
//
// This is the ONLY place goal numbers are computed. The Overview card is pure
// render: it receives a finished `Goal` payload and draws it. Swapping the goal
// type later (lean bulk / maintenance / recomp) means writing a new branch here
// and never touching the card.
//
// The evaluation deliberately smooths its inputs — a 30-day lean-mass average
// and a 14-day body-fat average — instead of using the day's raw readings, so
// Apple Health noise can't make progress appear to slide backwards.

import { rollingAvg } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";

export type GoalType = "fat_loss" | "lean_bulk" | "maintenance" | "recomp";

export interface GoalEvaluation {
  /** 0–100, how far along the fat-loss journey the smoothed body fat has come. */
  progressPct: number;
  /** Latest raw weight — the "where you are today" display value. */
  currentWeight: number;
  /** leanMass30dAvg / (1 − targetBodyFat/100). */
  goalWeight: number;
  /** currentWeight − goalWeight; positive = still to lose. */
  remainingWeight: number;
  /** Latest raw body-fat % — display value. */
  currentBodyFat: number;
  /** Target body-fat %, from config. */
  targetBodyFat: number;
  /** 30-day average lean mass (kg) — drives goalWeight. */
  leanMass30dAvg: number;
  /** 14-day average body fat (%) — drives progressPct. */
  bodyFat14dAvg: number;
}

export interface Goal {
  type: GoalType;
  targetBodyFat: number;
  evaluation: GoalEvaluation;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Build the fat-loss Goal payload, or null when there isn't enough body-
 *  composition data (no target, or no weight+bodyfat readings) to evaluate. */
export function computeGoal(
  metrics: BodyMetric[],
  targetBodyFat: number | null,
  cutStartBodyFat: number | null = null,
): Goal | null {
  if (targetBodyFat == null) return null;

  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const lmPts = metrics
    .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: (m.weight_kg as number) * (1 - (m.body_fat_pct as number) / 100) }));
  const wtPts = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));

  const leanMass30dAvg = rollingAvg(lmPts, 30, 0);
  const bodyFat14dAvg = rollingAvg(bfPts, 14, 0);
  const currentWeight = wtPts.at(-1)?.value ?? null;
  const currentBodyFat = bfPts.at(-1)?.value ?? null;

  if (leanMass30dAvg == null || bodyFat14dAvg == null || currentWeight == null || currentBodyFat == null) {
    return null;
  }

  const goalWeight = leanMass30dAvg / (1 - targetBodyFat / 100);
  const remainingWeight = currentWeight - goalWeight;

  // Progress = fraction of the body-fat gap closed since the starting point.
  // The start line is the fixed cut baseline from config — a value set once and
  // never drifting. If it hasn't been filled in yet, fall back to the current
  // 14-day average, which reads as 0% progress. Already-at-or-below-target
  // reads as 100%.
  const startBodyFat = cutStartBodyFat ?? bodyFat14dAvg;
  const span = startBodyFat - targetBodyFat;
  const progressPct = span > 0 ? clamp(((startBodyFat - bodyFat14dAvg) / span) * 100, 0, 100) : 100;

  return {
    type: "fat_loss",
    targetBodyFat,
    evaluation: {
      progressPct,
      currentWeight,
      goalWeight,
      remainingWeight,
      currentBodyFat,
      targetBodyFat,
      leanMass30dAvg,
      bodyFat14dAvg,
    },
  };
}
