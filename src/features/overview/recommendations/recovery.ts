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

import type { RecProvider } from "./types";

export const recoveryProvider: RecProvider = (ctx) => {
  const r = ctx.recovery;
  if (!r || r.status !== "Needs Recovery") return null;

  const subtitle =
    r.trainingLoad === "trained"
      ? "Recovery has run low after recent training — ease today's session."
      : r.trainingLoad === "rested"
        ? "Recovery has run low with little recent training — protect sleep before pushing."
        : "Recovery has run low — keep today easy.";

  return {
    source: "recovery",
    // Above a nutrition target tweak (72): an under-recovered body is more
    // time-sensitive than a calorie adjustment, and the two never really
    // compete in meaning. When it fires, it sits at the top of the stack.
    priority: 75,
    title: "Prioritize recovery",
    subtitle,
  };
};
