import { useEffect, useRef } from "react";
import { useCelebration } from "@shared/components/Celebration";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
import { trainingMonthsFromStart } from "@features/nutrition/logic";

const SEEN_KEY = "training-milestone-seen";

// Front-loaded ladder: monthly-ish at the start where each month is real
// progress, then annual once tenure is an identity fact. Celebrating every
// month long-term would dilute the gold; a year apart keeps each one an event.
const EARLY_RUNGS = [1, 3, 6, 9, 12];

/** Highest milestone (in completed months) at or below the given tenure. */
export function milestoneFor(months: number | null): number | null {
  if (months == null) return null;
  const m = Math.floor(months);
  if (m >= 12) return Math.floor(m / 12) * 12; // 12, 24, 36…
  let best: number | null = null;
  for (const rung of EARLY_RUNGS) if (m >= rung) best = rung;
  return best;
}

/** "3 Months" / "1 Year" / "1 Year 6 Months". */
export function fmtTenure(months: number): string {
  if (months < 12) return `${months} Month${months === 1 ? "" : "s"}`;
  const y = Math.floor(months / 12);
  const r = months % 12;
  const yStr = `${y} Year${y === 1 ? "" : "s"}`;
  return r ? `${yStr} ${r} Month${r === 1 ? "" : "s"}` : yStr;
}

/**
 * Fires a one-time gold celebration when training tenure crosses a milestone.
 * Mounted app-wide (Shell) so it evaluates once per launch, regardless of tab.
 *
 * On first ever run it baselines to the already-passed milestone WITHOUT
 * celebrating — so an existing multi-year user isn't spammed with every rung
 * they long since cleared; only their next crossing fires.
 */
export function TrainingMilestone() {
  const { config } = useNutritionConfig();
  const { celebrate, node } = useCelebration();
  const evaluated = useRef(false);

  useEffect(() => {
    if (!config || evaluated.current) return;
    // No start date yet → nothing to track. Don't baseline, so setting a date
    // later still records the correct already-passed milestone at that point.
    const months = trainingMonthsFromStart(config.training_start_date);
    if (months == null) return;
    evaluated.current = true;

    const ms = milestoneFor(months) ?? 0; // 0 = below the first rung
    const stored = localStorage.getItem(SEEN_KEY);
    if (stored == null) {
      localStorage.setItem(SEEN_KEY, String(ms)); // baseline, no celebration
      return;
    }
    if (ms > Number(stored)) {
      localStorage.setItem(SEEN_KEY, String(ms));
      celebrate({ variant: "milestone", title: fmtTenure(ms), sub: "Training milestone" });
    }
  }, [config, celebrate]);

  return node;
}
