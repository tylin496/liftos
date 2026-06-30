// Exercise catalog — ported from lift-log/data.js. Seeded into Supabase on first
// use; set history then lives in training_logs. Stretches are omitted in V1.

export type SplitId = "push" | "pull" | "legs";

export const SPLITS: { id: SplitId; name: string }[] = [
  { id: "push", name: "Push" },
  { id: "pull", name: "Pull" },
  { id: "legs", name: "Legs" },
];

export interface SeedExercise {
  slug: string;
  name: string;
  target: string;
  note?: string;
  assisted?: boolean;
}

export const SEED: Record<SplitId, SeedExercise[]> = {
  push: [
    { slug: "bench-press", name: "Bench Press", target: "5-8 × 3" },
    { slug: "pec-deck", name: "Pec Deck", target: "10-12 × 3", note: "2025：主要器材版本至 9 月" },
    { slug: "cable-fly", name: "Cable Fly", target: "10-12 × 3" },
    { slug: "incline-laterals", name: "Incline Laterals", target: "12 × 3" },
    { slug: "overhead-triceps-extension", name: "Overhead Triceps Extension", target: "12 × 2", note: "H16" },
  ],
  pull: [
    { slug: "assisted-pullup", name: "Assisted Pull-up", target: "6-8 × 3", note: "25 就可以自重了", assisted: true },
    { slug: "plate-lat-pulldown", name: "Plate-Loaded Lat Pulldown", target: "10-12" },
    { slug: "cable-lat-pulldown", name: "Cable Lat Pulldown", target: "10-12" },
    { slug: "low-row", name: "Low Row", target: "10-12 × 3" },
    { slug: "pull-around", name: "Pull-around", target: "10-12 × 2" },
    { slug: "reverse-cable-flyes", name: "Reverse Cable Flyes", target: "12 × 3", note: "H8 · Sweep out" },
    { slug: "preacher-curl", name: "Preacher Curl", target: "8-12 × 2", note: "2025：Curl 多版本，逐月取最高" },
  ],
  legs: [
    { slug: "leg-curl", name: "Leg Curl", target: "12 × 3" },
    { slug: "rdl", name: "RDL", target: "6-8 × 3" },
    { slug: "squat", name: "Squat", target: "6-8 × 3" },
    { slug: "leg-extension", name: "Leg Extension", target: "10-12 × 3" },
  ],
};
