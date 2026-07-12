// Primary limiting muscle for an exercise — the ONE muscle that usually reaches
// failure first, not every muscle involved. Single-muscle tagging is what makes
// cluster analysis meaningful: if every lift counted 2–3 muscles, a "chest
// fatigue" read would never separate from a "shoulder fatigue" read. Inferred
// from the name — no database column, no migration, no per-exercise selection.
// A muscle_group_override column can be added later for the rare misclassification.

export type MuscleGroup =
  | "chest" | "back" | "shoulders" | "biceps" | "triceps"
  | "quads" | "hamstrings" | "glutes" | "calves" | "abs"
  | "unknown";

// Ordered rules, FIRST MATCH WINS — specific disambiguations come before the
// generic keyword that would otherwise swallow them. The ordering IS the logic:
//  • "Leg Press/Extension/Curl" resolve to legs before the bare press/extension/
//    curl keywords claim them for chest/triceps/biceps.
//  • Rear-delt / reverse fly resolves to shoulders before the bare "fly" → chest.
//  • Shoulder/overhead press resolves to shoulders before the bare "press" → chest.
//  • "lateral" (shoulders) is a whole word, so it never fires on "lat pulldown".
const RULES: { re: RegExp; group: Exclude<MuscleGroup, "unknown"> }[] = [
  // ── legs disambiguations (must precede press/extension/curl) ──
  { re: /leg[-\s]?press/, group: "quads" },
  { re: /leg[-\s]?extension/, group: "quads" },
  { re: /(leg[-\s]?curl|nordic)/, group: "hamstrings" },
  // ── shoulders (rear delt / reverse fly before chest "fly"; press before chest) ──
  { re: /(rear[-\s]?delt|reverse.*fl(y|ies|yes))/, group: "shoulders" },
  { re: /(shoulder|overhead)[-\s]?press|\bohp\b/, group: "shoulders" },
  { re: /(lateral|side[-\s]?raise)/, group: "shoulders" },
  // ── triceps (before generic "extension" and "dip") ──
  { re: /(triceps?|pushdown|skull|\bdips?\b)/, group: "triceps" },
  // ── calves / abs / glutes (specific compounds before their generic parts) ──
  { re: /(calf|calves)/, group: "calves" },
  { re: /(leg[-\s]?raise|crunch|plank|sit[-\s]?up|ab[-\s]?wheel)/, group: "abs" },
  { re: /(hip[-\s]?thrust|glute|kickback|abduction|bridge)/, group: "glutes" },
  // ── hamstrings hip-hinges / quads squats ──
  { re: /(rdl|romanian|good[-\s]?morning|stiff[-\s]?leg)/, group: "hamstrings" },
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
 * Primary limiting muscle for an exercise. Priority: slug (most reliable — it's
 * a clean kebab-case key with no note/casing noise) → name keywords → split
 * fallback → "unknown". "unknown" lifts are simply excluded from cluster
 * analysis rather than guessed into the wrong group.
 */
export function inferMuscleGroup(name: string, slug: string, split?: string): MuscleGroup {
  return (
    matchRules(slug.toLowerCase()) ??
    matchRules(name.toLowerCase()) ??
    fromSplit(split)
  );
}
