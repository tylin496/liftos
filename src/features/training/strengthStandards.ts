// Strength standards — an ABSOLUTE coordinate for a lift, complementing the
// PR-distance system (which measures against your OWN past). Given a lift's
// estimated 1RM, your bodyweight, and sex, it names where that lift sits on the
// population ladder: Beginner → Novice → Intermediate → Advanced → Elite.
//
// This is a pure objective verdict — never a good/bad tone. A lift being
// "Novice" is a fact, not a failing (see the text-color rule: colour = verdict,
// and level is a locator, not a judgement). Only Elite, the celebrated ceiling,
// earns the gold treatment at the render layer.
//
// Scope + honesty:
//  • Standards are sex-specific and expressed as a MULTIPLE of bodyweight (1RM
//    ÷ bodyweight). Bodyweight-multiples are the widely-published shorthand;
//    they drift a little at bodyweight extremes (heavier lifters score lower
//    per kg), so treat a level as a band, not a precise percentile.
//  • Only barbell lifts with a published cross-population table get a standard:
//    the five classic lifts (long-established tables) plus RDL (crowdsourced
//    tables only — same ladder, a rung less authoritative). Machines, cables,
//    and isolations have no meaningful cross-population standard and correctly
//    return null (no level shown).
//  • Assisted / bodyweight lifts score on a %-bodyweight axis, not a 1RM in kg,
//    so they're out of scope here too (canonicalLift returns null for them).
import type { Exercise } from "./api";

export type Sex = "male" | "female";
export type StrengthLevel = "Beginner" | "Novice" | "Intermediate" | "Advanced" | "Elite";
export type CanonicalLift = "bench" | "squat" | "deadlift" | "rdl" | "ohp" | "row";

export const STRENGTH_LEVELS: StrengthLevel[] = ["Beginner", "Novice", "Intermediate", "Advanced", "Elite"];

/** The four floors (1RM ÷ bodyweight) to REACH Novice / Intermediate /
 *  Advanced / Elite. Below the first floor is Beginner, so four thresholds
 *  bucket into the five levels. Values are the broadly-accepted bodyweight-
 *  multiple standards for a ~lifetime-natural trainee; approximate by design. */
const THRESHOLDS: Record<Sex, Record<CanonicalLift, [number, number, number, number]>> = {
  male: {
    bench: [0.75, 1.1, 1.5, 2.0],
    squat: [1.2, 1.6, 2.0, 2.5],
    deadlift: [1.5, 2.0, 2.5, 3.0],
    // RDL: crowdsourced tables only (no long-established standard); sits at
    // roughly 75–80% of the conventional-deadlift floors, matching how the two
    // lifts load in practice.
    rdl: [1.0, 1.4, 1.8, 2.25],
    ohp: [0.55, 0.8, 1.05, 1.3],
    row: [0.75, 1.0, 1.35, 1.75],
  },
  female: {
    bench: [0.5, 0.75, 1.0, 1.5],
    squat: [0.75, 1.25, 1.6, 2.0],
    deadlift: [1.0, 1.25, 1.75, 2.5],
    rdl: [0.7, 1.1, 1.5, 2.0],
    ohp: [0.35, 0.5, 0.75, 1.0],
    row: [0.5, 0.7, 0.9, 1.2],
  },
};

const LIFT_LABEL: Record<CanonicalLift, string> = {
  bench: "Bench Press",
  squat: "Squat",
  deadlift: "Deadlift",
  rdl: "Romanian Deadlift",
  ohp: "Overhead Press",
  row: "Barbell Row",
};

export const liftLabel = (lift: CanonicalLift) => LIFT_LABEL[lift];

/** Map an exercise to a canonical standard lift, or null when none applies.
 *  Deliberately STRICT — a name has to clearly be the barbell movement the
 *  standard is built on. RDL has its own table; variations without one that
 *  load very differently (front squat, sumo, machine/cable rows, incline
 *  bench) are left out rather than compared against a table that doesn't fit
 *  them: a wrong level is worse than no level. Assisted / non-compound lifts
 *  are excluded up front. */
export function canonicalLift(exercise: Pick<Exercise, "name" | "compound" | "assisted_mode">): CanonicalLift | null {
  if (!exercise.compound || exercise.assisted_mode) return null;
  const n = exercise.name.toLowerCase();

  // Exclusions first — variants that share a keyword but not the standard.
  if (/\b(stiff.?leg|good.?morning|sumo|hack|front squat|incline|decline)\b/.test(n)) return null;
  if (/\b(machine|cable|smith|pec|hammer)\b/.test(n)) return null;

  if (/\bbench\b/.test(n) || n === "flat bench press") return "bench";
  if (/\bsquat\b/.test(n)) return "squat";
  // RDL before deadlift — "Romanian Deadlift" must land on its own table, not
  // the conventional one.
  if (/\b(rdl|romanian)\b/.test(n)) return "rdl";
  if (/\bdead\s?lift\b/.test(n) || /\bdeadlift\b/.test(n)) return "deadlift";
  if (/\b(overhead press|ohp|military press|shoulder press|push press|strict press)\b/.test(n)) return "ohp";
  if (/\b(barbell row|bent.?over row|pendlay|bb row)\b/.test(n)) return "row";
  return null;
}

export interface StrengthStanding {
  lift: CanonicalLift;
  liftLabel: string;
  /** 1RM ÷ bodyweight, the standard's own unit. */
  ratio: number;
  level: StrengthLevel;
  levelIndex: number; // 0..4 into STRENGTH_LEVELS
  /** The next rung up, and the extra 1RM (kg) to reach it — null at Elite. */
  nextLevel: StrengthLevel | null;
  kgToNext: number | null;
  /** 0..1 progress from the current level's floor to the next's — how far into
   *  the current band this lift sits. 1 at Elite (the ladder tops out). */
  progressToNext: number;
}

/** Where a lift's estimated 1RM sits on the population ladder, or null when the
 *  lift has no standard, sex is unset, or bodyweight is unusable. */
export function strengthStanding(
  lift: CanonicalLift | null,
  e1rmKg: number | null,
  bodyweightKg: number | null,
  sex: Sex | null,
): StrengthStanding | null {
  if (!lift || sex == null) return null;
  if (e1rmKg == null || !isFinite(e1rmKg) || e1rmKg <= 0) return null;
  if (bodyweightKg == null || !isFinite(bodyweightKg) || bodyweightKg <= 0) return null;

  const floors = THRESHOLDS[sex][lift];
  const ratio = e1rmKg / bodyweightKg;

  // levelIndex = how many floors the ratio has cleared (0 → Beginner, 4 → Elite).
  let levelIndex = 0;
  for (const f of floors) {
    if (ratio >= f) levelIndex++;
    else break;
  }

  const level = STRENGTH_LEVELS[levelIndex];
  const nextLevel = levelIndex < 4 ? STRENGTH_LEVELS[levelIndex + 1] : null;

  // Progress within the current band. The Beginner band's floor is 0; each
  // higher band spans floors[i-1]..floors[i]. Elite has no ceiling → 1.
  let progressToNext = 1;
  let kgToNext: number | null = null;
  if (nextLevel != null) {
    const bandStart = levelIndex === 0 ? 0 : floors[levelIndex - 1];
    const bandEnd = floors[levelIndex];
    progressToNext = Math.max(0, Math.min(1, (ratio - bandStart) / (bandEnd - bandStart)));
    kgToNext = Math.max(0, Math.round((bandEnd * bodyweightKg - e1rmKg) * 10) / 10);
  }

  return {
    lift,
    liftLabel: LIFT_LABEL[lift],
    ratio: Math.round(ratio * 100) / 100,
    level,
    levelIndex,
    nextLevel,
    kgToNext,
    progressToNext,
  };
}

export const isSex = (v: unknown): v is Sex => v === "male" || v === "female";
