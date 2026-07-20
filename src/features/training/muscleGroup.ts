// Primary limiting muscle for an exercise — the ONE muscle that usually reaches
// failure first, not every muscle involved. Single-muscle tagging is what makes
// cluster analysis meaningful: if every lift counted 2–3 muscles, a "chest
// fatigue" read would never separate from a "shoulder fatigue" read. Inferred
// from the name; `exercises.muscle_group_override` (migration 0018) pins the
// rare misclassification and short-circuits inference entirely.

export type MuscleGroup =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes" | "calves" | "abs"
  | "unknown";

/** The storable groups, in display order — the edit form's option list and the
 *  override validator both read this. "unknown" is deliberately absent: you
 *  clear an override, you never set one to unknown. */
export const MUSCLE_GROUPS: Exclude<MuscleGroup, "unknown">[] = [
  "chest", "back", "shoulders", "biceps", "triceps",
  "quads", "hamstrings", "glutes", "calves", "abs",
];

/** Narrow a raw DB string to a storable MuscleGroup. An unrecognised value
 *  (typo'd row, future rename) falls back to inference instead of poisoning
 *  the cluster keys. */
export function asMuscleGroup(s: string | null | undefined): Exclude<MuscleGroup, "unknown"> | null {
  return (MUSCLE_GROUPS as string[]).includes(s ?? "")
    ? (s as Exclude<MuscleGroup, "unknown">)
    : null;
}

// Ordered rules, FIRST MATCH WINS — specific disambiguations come before the
// generic keyword that would otherwise swallow them. The ordering IS the logic:
//  • "Leg Press/Extension/Curl" resolve to legs before the bare press/extension/
//    curl keywords claim them for chest/triceps/biceps.
//  • Rear-delt / reverse fly/pec resolves to shoulders before the bare "fly"/"pec" → chest.
//  • Shoulder/overhead press resolves to shoulders before the bare "press" → chest.
//  • "\blateral" (shoulders) is start-anchored: "laterals" fires, "unilateral" doesn't.
const RULES: { re: RegExp; group: Exclude<MuscleGroup, "unknown"> }[] = [
  // ── legs disambiguations (must precede press/extension/curl) ──
  { re: /leg[-\s]?press/, group: "quads" },
  { re: /leg[-\s]?extension/, group: "quads" },
  // "glute ham raise" is a hamstring lift — must precede the glute keyword below.
  { re: /((leg|ham)[-\s]?curl|hamstring|nordic|glute[-\s]?ham)/, group: "hamstrings" },
  // ── shoulders (rear delt / reverse fly/pec before chest; press before chest) ──
  { re: /(rear[-\s]?delt|face[-\s]?pull|reverse.*(fl(y|ies|yes)|pec))/, group: "shoulders" },
  { re: /(shoulder|overhead|arnold|military)[-\s]?press|\bohp\b/, group: "shoulders" },
  // \blaterals?\b: bare "Laterals" (e.g. "Incline Laterals") fires without a
  // trailing "raise"; the boundary keeps "unilateral" from matching.
  { re: /(\blaterals?\b|(side|front)[-\s]?raise)/, group: "shoulders" },
  // Upright row is a delt movement — must precede the back \brow\b below, which
  // would otherwise swallow it.
  { re: /upright[-\s]?row/, group: "shoulders" },
  // ── triceps (before generic "extension" and "dip") ──
  { re: /(triceps?|pushdown|skull|\bdips?\b)/, group: "triceps" },
  // ── calves / abs / glutes (specific compounds before their generic parts) ──
  { re: /(calf|calves)/, group: "calves" },
  { re: /(leg[-\s]?raise|crunch|plank|sit[-\s]?up|ab[-\s]?wheel)/, group: "abs" },
  { re: /(hip[-\s]?thrust|glute|kickback|abduct|bridge)/, group: "glutes" },
  // ── hamstrings hip-hinges / quads squats ──
  // All hip-hinges tag hamstrings (coarse, overridable) — deadlift and back
  // extension included, so a bare "Deadlift" with no split isn't dropped to
  // "unknown" and "Back Extension" isn't swallowed by the generic extension →
  // triceps fallback. \brdl\b so "hurdle" can't fire it.
  { re: /(\brdl\b|romanian|good[-\s]?morning|stiff[-\s]?leg|deadlift|back[-\s]?extension|hyperextension)/, group: "hamstrings" },
  { re: /(squat|hack)/, group: "quads" },
  // ── back pulls ──
  { re: /(pulldown|pull[-\s]?up|pullup|pull[-\s]?around|pullover|chin[-\s]?up|\brow\b)/, group: "back" },
  // ── biceps (leg-curl already caught above, so "curl" here is safe) ──
  { re: /(preacher|hammer|curl)/, group: "biceps" },
  // ── chest (leg/shoulder press already caught, so "press" here is chest) ──
  { re: /(pec|bench|chest|\bfl(y|ies|yes)\b|press)/, group: "chest" },
  // ── generic extension → triceps (leg-extension already caught) ──
  { re: /extension/, group: "triceps" },
];

function matchRules(s: string): Exclude<MuscleGroup, "unknown"> | null {
  for (const { re, group } of RULES) if (re.test(s)) return group;
  return null;
}

/** Rough per-split default — the LAST resort, only when name & slug both miss.
 *  A push day's most likely limiter is chest, pull's is back, legs' is quads.
 *  Deliberately coarse; a wrong guess here is overridable and rare (real lifts
 *  almost always hit a keyword first). */
function fromSplit(split: string | undefined): MuscleGroup {
  switch (split) {
    case "push": return "chest";
    case "pull": return "back";
    case "legs": return "quads";
    default: return "unknown";
  }
}

/**
 * Primary limiting muscle for an exercise. Priority: explicit override (the
 * user said so — beats every heuristic) → slug (most reliable — it's a clean
 * kebab-case key with no note/casing noise) → name keywords → split fallback →
 * "unknown". "unknown" lifts are simply excluded from cluster analysis rather
 * than guessed into the wrong group.
 */
export function inferMuscleGroup(
  name: string,
  slug: string,
  split?: string,
  override?: string | null,
): MuscleGroup {
  return (
    asMuscleGroup(override) ??
    matchRules(slug.toLowerCase()) ??
    matchRules(name.toLowerCase()) ??
    fromSplit(split)
  );
}

/** Resolve every exercise row's muscle once (override-aware) into a slug-keyed
 *  map — the shape the grid/cluster/volume consumers look muscles up by. One
 *  resolution point, so a pinned override can never reach one surface and miss
 *  another. `muscle_group_override` is optional so rows read before migration
 *  0018 lands (or mock rows) simply fall through to inference. */
export function resolveMuscleBySlug(
  rows: Array<{
    slug: string;
    name: string;
    split?: string | null;
    muscle_group_override?: string | null;
  }>,
): Map<string, MuscleGroup> {
  return new Map(
    rows.map((r) => [
      r.slug,
      inferMuscleGroup(r.name, r.slug, r.split ?? undefined, r.muscle_group_override),
    ]),
  );
}
