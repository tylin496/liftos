import { describe, it, expect } from "vitest";
import { inferMuscleGroup, type MuscleGroup } from "./muscleGroup";

// The 15 real exercises, classified exactly as the user specified. slug + name
// are the real seed values (see seed.ts); split disambiguates only as a fallback.
const SEED: { slug: string; name: string; split: string; expect: MuscleGroup }[] = [
  { slug: "bench-press", name: "Bench Press", split: "push", expect: "chest" },
  { slug: "pec-deck", name: "Pec Deck", split: "push", expect: "chest" },
  { slug: "cable-fly", name: "Cable Fly", split: "push", expect: "chest" },
  { slug: "incline-laterals", name: "Incline Laterals", split: "push", expect: "shoulders" },
  { slug: "reverse-cable-flyes", name: "Reverse Cable Flyes", split: "pull", expect: "shoulders" },
  { slug: "overhead-triceps-extension", name: "Overhead Triceps Extension", split: "push", expect: "triceps" },
  { slug: "preacher-curl", name: "Preacher Curl", split: "pull", expect: "biceps" },
  { slug: "assisted-pullup", name: "Assisted Pull-up", split: "pull", expect: "back" },
  { slug: "plate-lat-pulldown", name: "Plate-Loaded Lat Pulldown", split: "pull", expect: "back" },
  { slug: "cable-lat-pulldown", name: "Cable Lat Pulldown", split: "pull", expect: "back" },
  { slug: "low-row", name: "Low Row", split: "pull", expect: "back" },
  { slug: "pull-around", name: "Pull-around", split: "pull", expect: "back" },
  { slug: "squat", name: "Squat", split: "legs", expect: "quads" },
  { slug: "leg-extension", name: "Leg Extension", split: "legs", expect: "quads" },
  { slug: "leg-curl", name: "Leg Curl", split: "legs", expect: "hamstrings" },
  { slug: "rdl", name: "RDL", split: "legs", expect: "hamstrings" },
];

describe("inferMuscleGroup — the user's 15 exercises", () => {
  for (const ex of SEED) {
    it(`${ex.name} → ${ex.expect}`, () => {
      expect(inferMuscleGroup(ex.name, ex.slug, ex.split)).toBe(ex.expect);
    });
  }
});

describe("inferMuscleGroup — rule disambiguations (future exercises)", () => {
  const cases: [string, string, MuscleGroup][] = [
    // legs keywords must beat the bare press/extension/curl
    ["Leg Press", "leg-press", "quads"],
    ["Hack Squat", "hack-squat", "quads"],
    ["Bulgarian Split Squat", "split-squat", "quads"],
    ["Nordic Curl", "nordic-curl", "hamstrings"],
    ["Good Morning", "good-morning", "hamstrings"],
    // shoulders: rear delt & overhead press before chest fly/press
    ["Rear Delt Fly", "rear-delt-fly", "shoulders"],
    ["Overhead Press", "overhead-press", "shoulders"],
    ["Lateral Raise", "lateral-raise", "shoulders"],
    // triceps before generic extension; dip → triceps
    ["Tricep Pushdown", "tricep-pushdown", "triceps"],
    ["Skull Crusher", "skull-crusher", "triceps"],
    ["Dips", "dips", "triceps"],
    // biceps
    ["Hammer Curl", "hammer-curl", "biceps"],
    // glutes / calves / abs
    ["Hip Thrust", "hip-thrust", "glutes"],
    ["Glute Kickback", "glute-kickback", "glutes"],
    ["Standing Calf Raise", "calf-raise", "calves"],
    ["Cable Crunch", "cable-crunch", "abs"],
    ["Hanging Leg Raise", "leg-raise", "abs"],
    // back
    ["Chest-Supported Row", "chest-supported-row", "back"],
    ["Pullover", "pullover", "back"],
    // "lat" in a pulldown must NOT read as "lateral" (shoulders)
    ["Lat Pulldown", "lat-pulldown", "back"],
  ];
  for (const [name, slug, want] of cases) {
    it(`${name} → ${want}`, () => {
      expect(inferMuscleGroup(name, slug)).toBe(want);
    });
  }
});

describe("inferMuscleGroup — fallbacks", () => {
  it("falls back to the split default when name & slug miss", () => {
    expect(inferMuscleGroup("Mystery Move", "mystery-move", "push")).toBe("chest");
    expect(inferMuscleGroup("Mystery Move", "mystery-move", "pull")).toBe("back");
    expect(inferMuscleGroup("Mystery Move", "mystery-move", "legs")).toBe("quads");
  });
  it("returns 'unknown' when nothing matches and there's no split", () => {
    expect(inferMuscleGroup("Mystery Move", "mystery-move")).toBe("unknown");
  });
});
