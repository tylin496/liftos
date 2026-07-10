// Muscle-cluster analysis — the layer above per-lift trajectory. A single lift
// dipping is noise or technique; several lifts sharing a primary muscle dipping
// TOGETHER, in the same training block, is a systemic signal (that muscle isn't
// recovering). This is exactly what a per-lift-only engine can't see. Rides on
// the trajectory layer (overview/strength.ts) — it reads `trajectory.direction`,
// it doesn't recompute any trend.

import type { StrengthExercise } from "@features/overview/strength";
import { inferMuscleGroup, type MuscleGroup } from "./muscleGroup";

/** A muscle needs at least this many judged lifts before a "cluster" reads at
 *  all — one lift is never a cluster. */
const CLUSTER_MIN_LIFTS = 2;
/** Declining lifts only count as SHARED fatigue if their most recent sessions
 *  fall within one training block of each other. Two lifts sliding months apart
 *  aren't the same fatigue event — they're two separate stories. */
const CLUSTER_BLOCK_DAYS = 14;
const DAY_MS = 86_400_000;

export interface MuscleCluster {
  muscle: Exclude<MuscleGroup, "unknown">;
  /** Slugs of the judged lifts in this group. */
  slugs: string[];
  /** Slugs whose trajectory is currently declining. */
  decliningSlugs: string[];
  /** ≥2 lifts in the group declining AND last-trained within one block of each
   *  other → the muscle, not the exercise, is the story. */
  systemicFatigue: boolean;
  /** Mean trajectory confidence of the declining lifts (0 when none) — a
   *  systemic flag off two sparsely-logged lifts should read low-confidence. */
  confidence: number;
}

/** All muscle groups with ≥2 judged lifts, each carrying whether its recent
 *  declines line up into shared fatigue. Healthy groups (0 decliners) are kept
 *  too — a "chest: 3 lifts, none declining" read is useful context, not noise.
 *  `muscleOf` lets a caller that holds the exercise records (with `split`) pass
 *  a fully-informed resolver; the default infers from the lift's name + slug. */
export function computeMuscleClusters(
  exercises: StrengthExercise[],
  muscleOf: (ex: StrengthExercise) => MuscleGroup = (ex) => inferMuscleGroup(ex.name, ex.slug),
): MuscleCluster[] {
  const byMuscle = new Map<Exclude<MuscleGroup, "unknown">, StrengthExercise[]>();
  for (const ex of exercises) {
    const m = muscleOf(ex);
    if (m === "unknown") continue; // unclassified lifts don't pollute a cluster
    const list = byMuscle.get(m) ?? [];
    list.push(ex);
    byMuscle.set(m, list);
  }

  const clusters: MuscleCluster[] = [];
  for (const [muscle, list] of byMuscle) {
    if (list.length < CLUSTER_MIN_LIFTS) continue;
    const decliners = list.filter((e) => e.trajectory.direction === "declining");

    // Shared-block check: the decliners' latest sessions must span ≤ one block.
    let sameBlock = false;
    if (decliners.length >= 2) {
      const times = decliners.map((e) => Date.parse(e.lastLogDate)).sort((a, b) => a - b);
      sameBlock = (times[times.length - 1] - times[0]) / DAY_MS <= CLUSTER_BLOCK_DAYS;
    }
    const systemicFatigue = decliners.length >= 2 && sameBlock;

    const confidence = decliners.length
      ? Math.round(
          (decliners.reduce((s, e) => s + e.trajectory.confidence, 0) / decliners.length) * 100,
        ) / 100
      : 0;

    clusters.push({
      muscle,
      slugs: list.map((e) => e.slug),
      decliningSlugs: decliners.map((e) => e.slug),
      systemicFatigue,
      confidence,
    });
  }

  // Systemic-fatigue groups first (the actionable ones), then by how many lifts
  // back the group (denser groups read as more trustworthy context).
  return clusters.sort(
    (a, b) => Number(b.systemicFatigue) - Number(a.systemicFatigue) || b.slugs.length - a.slugs.length,
  );
}

export interface ClusterFatigueAdvice {
  muscle: Exclude<MuscleGroup, "unknown">;
  /** Display names of the lifts sliding together. */
  lifts: string[];
  /** All judged lifts in the muscle group (sliding + holding) — the card's dot
   *  strip denominator, so "2 of 3 chest lifts" is renderable without re-running
   *  the cluster pass. */
  groupSize: number;
  confidence: number;
  /** Structured pieces for the card block: the verdict ("Chest isn't
   *  recovering") and the next step, separately. `action` remains their
   *  one-sentence join — the AI export's flat string. */
  headline: string;
  step: string;
  /** The muscle-level next step — a SINGLE imperative, same contract as
   *  deload.ts's `action` (no "N weeks" context prefix). The point it makes that
   *  per-lift deload can't: the muscle isn't recovering, so pulling one
   *  movement's load isn't the fix — pull the muscle's weekly volume. */
  action: string;
}

/** Turn a systemic-fatigue cluster into its one muscle-level action, or null if
 *  the cluster isn't flagged. The decision layer above per-lift `suggestDeload`:
 *  when several lifts of a muscle slide together, the fix is volume/recovery at
 *  the muscle, not a −10% on a single lift. `nameOf` maps slug → display name. */
export function suggestClusterFatigue(
  cluster: MuscleCluster,
  nameOf: (slug: string) => string = (s) => s,
): ClusterFatigueAdvice | null {
  if (!cluster.systemicFatigue) return null;
  const lifts = cluster.decliningSlugs.map(nameOf);
  const muscle = cluster.muscle;
  const Muscle = muscle.charAt(0).toUpperCase() + muscle.slice(1);
  const headline = `${Muscle} isn't recovering`;
  const step = `Back off ${muscle} volume this week, not just one movement.`;
  return {
    muscle,
    lifts,
    groupSize: cluster.slugs.length,
    confidence: cluster.confidence,
    headline,
    step,
    action: `${headline} — ${lifts.length} lifts sliding together. ${step}`,
  };
}
