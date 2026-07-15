// Recovery recommendation provider.
//
// Recovery only speaks up when readiness is *sustainedly* low. The recovery
// snapshot is already 7-day-smoothed against a 30-day baseline, so "Needs
// Recovery" (score 0) is a settled dip — not a single bad night — and safe to
// act on. Anything better than that stays silent: a recommendation is an
// intervention signal, not a running commentary (that's the Health Recovery
// card's job).
//
// The action framing turns on recent training load — the one thing active
// energy can't tell us. Low readiness *after* training means back off the
// session; low readiness *without* it is life/sleep stress, so pushing training
// won't fix it. That distinction is why exercise_minutes earns its place: it
// changes the advice, not just a displayed number.

import type { RecProvider, Recommendation } from "./types";
import type { RecoveryEvaluation } from "@features/health/math";

/** The recovery directive's title. Single source of truth: the engine keys its
 *  exit-hysteresis on this exact string, so it imports the constant from here
 *  rather than re-typing the literal — a copy edit to the title can't silently
 *  break the hold. */
export const RECOVERY_TITLE = "Prioritize recovery";

/** The recovery directive itself, framed by recent training load. Exported so the
 *  Decision Engine can hold it under exit-hysteresis (keeping it through a brief
 *  dip to "Fair") without duplicating the copy. Assumes the caller already
 *  decided recovery should speak — it applies no readiness gate of its own. */
export function recoveryRecommendation(r: RecoveryEvaluation): Recommendation {
  const subtitle =
    r.trainingLoad === "trained"
      ? "Recovery has run low after recent training — ease today's session"
      : r.trainingLoad === "rested"
        ? "Recovery has run low with little recent training — protect sleep before pushing"
        : "Recovery has run low — keep today easy";
  return {
    source: "recovery",
    // Above a nutrition target tweak (72): an under-recovered body is more
    // time-sensitive than a calorie adjustment, and the two never really
    // compete in meaning.
    priority: 75,
    title: RECOVERY_TITLE,
    subtitle,
    // Only a *systemic* dip (low readiness with little recent training) is the
    // user's to explain away — that's the sickness/travel case they can dismiss.
    // A post-training dip ("trained") self-releases fast and stays non-dismissible;
    // "keep today easy" advice for an actively-training body shouldn't be hidden.
    dismissible: r.trainingLoad === "rested",
  };
}

export const recoveryProvider: RecProvider = (ctx) => {
  const r = ctx.recovery;
  if (!r || r.status !== "Needs Recovery") return null;
  return recoveryRecommendation(r);
};
