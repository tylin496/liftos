// Per-exercise deload suggestion — the one bit of Decision Support the Training
// Health card was missing. Everything upstream (status, stalledWeeks,
// needsAttention, lastPRDetail) is already computed in overview/strength.ts;
// this only turns a *flagged* lift into its single next action.
//
// Deliberately NOT an LLM call. The advice is a fixed heuristic — stuck below PR
// long enough → back the load off ~10% and rebuild; slipping acutely → ease off,
// don't grind through it — so it stays pure, free, offline, and unit-testable,
// the same contract as every other recommendation. An LLM would only rephrase
// this, at the cost of a backend key, non-determinism, and number-hallucination
// risk; it decides nothing the data doesn't already decide.

import type { StrengthExercise } from "@features/overview/strength";

/** Fraction to back the working load off to when rebuilding from a plateau. */
const DELOAD_FACTOR = 0.9; // −10%
/** Round suggested loads to a gym-friendly increment (kg). */
const ROUND_KG = 2.5;

export type DeloadReason = "plateau" | "decline";

export interface DeloadSuggestion {
  slug: string;
  name: string;
  /** Why it's flagged — a chronic plateau reads differently from an acute slide. */
  reason: DeloadReason;
  stalledWeeks: number;
  /** The load we're backing off from (parsed from lastPRDetail), or null when the
   *  PR detail wasn't available — the message then stays weight-free. */
  fromKg: number | null;
  /** Suggested deload target in kg, or null when fromKg is unknown. */
  targetKg: number | null;
  /** The imperative next step ALONE — "Drop to ~70 kg and build back up". No
   *  "stalled N weeks" context prefix: surfaces that already show the plateau
   *  note (Training Health card) shouldn't restate it. Weight-free when fromKg
   *  is null. Callers wanting the standalone one-liner compose it from `reason`
   *  + `stalledWeeks` + this. */
  action: string;
}

/** Parse the plateau load out of strength.ts's `lastPRDetail` ("77 kg × 7"). */
function parseFromKg(lastPRDetail: string): number | null {
  const m = /^([\d.]+)\s*kg/.exec(lastPRDetail);
  if (!m) return null;
  const kg = Number(m[1]);
  return Number.isFinite(kg) && kg > 0 ? kg : null;
}

function roundTo(kg: number, step: number): number {
  return Math.round(kg / step) * step;
}

/** The next action for one flagged lift, or null if it isn't flagged. Reads only
 *  the trusted `needsAttention` gate — never re-derives its own threshold — so it
 *  can't disagree with the Needs-Attention list, the export, or the engine. */
export function suggestDeload(
  ex: Pick<
    StrengthExercise,
    "slug" | "name" | "needsAttention" | "declining" | "stalledWeeks" | "lastPRDetail"
  >,
): DeloadSuggestion | null {
  if (!ex.needsAttention) return null;

  const reason: DeloadReason = ex.declining ? "decline" : "plateau";
  const fromKg = parseFromKg(ex.lastPRDetail);
  const targetKg = fromKg != null ? roundTo(fromKg * DELOAD_FACTOR, ROUND_KG) : null;

  let action: string;
  if (targetKg != null) {
    action =
      reason === "decline"
        ? `Ease back to ~${targetKg} kg and rebuild — don't grind through it`
        : `Drop to ~${targetKg} kg (−10%) and build back up`;
  } else {
    action =
      reason === "decline"
        ? "Ease the load and rebuild — don't grind through it"
        : "Deload ~10% and build back up";
  }

  return { slug: ex.slug, name: ex.name, reason, stalledWeeks: ex.stalledWeeks, fromKg, targetKg, action };
}
