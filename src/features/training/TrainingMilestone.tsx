import { useEffect, useRef } from "react";
import { useCelebration } from "@shared/components/Celebration";
import { useToast } from "@shared/components/Toast";
import { useNutritionConfig } from "@features/nutrition/NutritionConfigContext";
import { trainingMonthsFromStart } from "@features/nutrition/logic";

const SEEN_KEY = "training-milestone-seen";

/** Highest milestone (in completed months) at or below the given tenure —
    every 3 months (3, 6, 9, 12, 15…). Quarterly keeps each one a real event
    without diluting the gold the way a monthly cadence would. */
export function milestoneFor(months: number | null): number | null {
  if (months == null) return null;
  const m = Math.floor(months);
  if (m < 3) return null;
  return Math.floor(m / 3) * 3;
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
 * Fires a one-time reward when training tenure crosses a 3-month milestone.
 * Two tiers: a whole-year mark (12/24/36…) gets the big sticky gold
 * celebration; the in-between quarters (3/6/9/15…) get a lightweight toast.
 * Mounted app-wide (Shell) so it evaluates once per launch, regardless of tab.
 *
 * On first ever run it baselines to the already-passed milestone WITHOUT
 * celebrating — so an existing multi-year user isn't spammed with every rung
 * they long since cleared; only their next crossing fires.
 */
export function TrainingMilestone() {
  const { config } = useNutritionConfig();
  const { celebrate, node } = useCelebration();
  const addToast = useToast();
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
      const label = fmtTenure(ms);
      if (ms % 12 === 0) {
        // Whole-year mark — the big sticky moment.
        celebrate({ variant: "milestone", title: label, sub: "Training milestone", sticky: true });
      } else {
        // In-between quarter — a quiet toast, no confetti.
        addToast(`${label} of training`, "success", 4000);
      }
    }
  }, [config, celebrate, addToast]);

  return node;
}
