// Small shared numeric helpers. These one-liners were re-defined in several
// features; kept here so there's a single clamp/clamp01 to import.

/** Clamp `v` into the inclusive [lo, hi] range. */
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Clamp into [0, 1] — the common case for normalized ratios/progress. */
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
