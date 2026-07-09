import { describe, it, expect } from "vitest";
import { computeMuscleClusters, suggestClusterFatigue } from "./muscleCluster";
import type { StrengthExercise } from "@features/overview/strength";
import type { TrendDirection } from "@features/overview/strength";

// Minimal StrengthExercise factory — only the fields the cluster reads matter
// (slug, name, trajectory.direction/confidence, lastLogDate); the rest are
// plausible filler so the type is satisfied.
function ex(
  slug: string,
  name: string,
  dir: TrendDirection,
  lastLogDate: string,
  confidence = 0.8,
): StrengthExercise {
  return {
    slug, name,
    status: "stable",
    latestE1RM: 100, prE1RM: 100, trend: 1,
    stalledWeeks: 0,
    lastLogDate,
    lastPRDate: lastLogDate,
    needsAttention: false,
    recovering: false,
    declining: dir === "declining",
    recentBests: [100, 100, 100, 100],
    trajectory: { direction: dir, velocity: dir === "stable" ? 0 : -0.05, confidence },
    lastPRKind: "strength",
    lastPRDetail: "",
  };
}

describe("computeMuscleClusters", () => {
  it("flags systemic fatigue when ≥2 lifts of a muscle decline in the same block", () => {
    const clusters = computeMuscleClusters([
      ex("bench-press", "Bench Press", "declining", "2026-07-05"),
      ex("pec-deck", "Pec Deck", "declining", "2026-07-08"),
      ex("cable-fly", "Cable Fly", "stable", "2026-07-06"),
    ]);
    const chest = clusters.find((c) => c.muscle === "chest")!;
    expect(chest.slugs).toHaveLength(3);
    expect(chest.decliningSlugs.sort()).toEqual(["bench-press", "pec-deck"]);
    expect(chest.systemicFatigue).toBe(true);
  });

  it("does NOT flag when the two declines are separated by more than a block", () => {
    const clusters = computeMuscleClusters([
      ex("bench-press", "Bench Press", "declining", "2026-06-01"),
      ex("pec-deck", "Pec Deck", "declining", "2026-07-08"), // ~5 weeks later
    ]);
    expect(clusters.find((c) => c.muscle === "chest")!.systemicFatigue).toBe(false);
  });

  it("a single declining lift is never a cluster fatigue signal", () => {
    const clusters = computeMuscleClusters([
      ex("bench-press", "Bench Press", "declining", "2026-07-05"),
      ex("pec-deck", "Pec Deck", "stable", "2026-07-08"),
    ]);
    expect(clusters.find((c) => c.muscle === "chest")!.systemicFatigue).toBe(false);
  });

  it("drops muscles with fewer than two judged lifts, and 'unknown' lifts", () => {
    const clusters = computeMuscleClusters([
      ex("squat", "Squat", "declining", "2026-07-05"),          // only quad → dropped
      ex("mystery", "Mystery Move", "declining", "2026-07-06"), // unknown → dropped
      ex("bench-press", "Bench Press", "stable", "2026-07-05"),
      ex("pec-deck", "Pec Deck", "stable", "2026-07-06"),       // chest has 2 → kept
    ]);
    expect(clusters.map((c) => c.muscle)).toEqual(["chest"]);
  });

  it("confidence is the mean of the declining lifts' trajectory confidence", () => {
    const clusters = computeMuscleClusters([
      ex("bench-press", "Bench Press", "declining", "2026-07-05", 0.9),
      ex("pec-deck", "Pec Deck", "declining", "2026-07-08", 0.5),
    ]);
    expect(clusters.find((c) => c.muscle === "chest")!.confidence).toBe(0.7);
  });

  it("orders systemic-fatigue clusters first", () => {
    const clusters = computeMuscleClusters([
      ex("bench-press", "Bench Press", "stable", "2026-07-05"),
      ex("pec-deck", "Pec Deck", "stable", "2026-07-06"),   // chest: healthy
      ex("cable-fly", "Cable Fly", "stable", "2026-07-06"),
      ex("leg-curl", "Leg Curl", "declining", "2026-07-05"),
      ex("rdl", "RDL", "declining", "2026-07-08"),          // hamstrings: systemic
    ]);
    expect(clusters[0].muscle).toBe("hamstrings");
    expect(clusters[0].systemicFatigue).toBe(true);
  });
});

describe("suggestClusterFatigue", () => {
  const nameOf = (s: string) => ({ "leg-curl": "Leg Curl", rdl: "RDL" })[s] ?? s;

  it("turns a systemic cluster into a muscle-level action naming the lifts", () => {
    const [cluster] = computeMuscleClusters([
      ex("leg-curl", "Leg Curl", "declining", "2026-07-05"),
      ex("rdl", "RDL", "declining", "2026-07-08"),
    ]);
    const advice = suggestClusterFatigue(cluster, nameOf)!;
    expect(advice.muscle).toBe("hamstrings");
    expect(advice.lifts.sort()).toEqual(["Leg Curl", "RDL"]);
    expect(advice.action).toContain("Hamstrings isn't recovering");
    expect(advice.action).toContain("Back off hamstrings volume");
  });

  it("returns null for a cluster that isn't flagged", () => {
    const [cluster] = computeMuscleClusters([
      ex("leg-curl", "Leg Curl", "declining", "2026-07-05"),
      ex("rdl", "RDL", "stable", "2026-07-08"), // only 1 decliner → not systemic
    ]);
    expect(suggestClusterFatigue(cluster, nameOf)).toBeNull();
  });
});
