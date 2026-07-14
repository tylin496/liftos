import { describe, it, expect } from "vitest";
import { suggestDeload } from "./deload";
import type { StrengthExercise } from "@features/overview/strength";

// Minimal flagged-exercise factory — only the fields suggestDeload reads.
function ex(over: Partial<StrengthExercise> = {}): StrengthExercise {
  return {
    slug: "pec-deck",
    name: "Pec Deck",
    status: "watch",
    latestE1RM: 80,
    prE1RM: 90,
    trend: 0.89,
    stalledWeeks: 13,
    lastLogDate: "2026-07-08",
    lastPRDate: "2026-04-06",
    needsAttention: true,
    recovering: false,
    declining: false,
    recentBests: [88, 85, 84, 82, 80],
    trajectory: { direction: "stable", velocity: 0, confidence: 0.6 },
    lastPRKind: "hypertrophy",
    lastPRDetail: "77 kg × 7",
    ...over,
  };
}

describe("suggestDeload", () => {
  it("stays silent unless the lift is flagged (needsAttention)", () => {
    expect(suggestDeload(ex({ needsAttention: false }))).toBeNull();
  });

  it("turns a chronic plateau into a deload-and-rebuild step", () => {
    const s = suggestDeload(ex())!;
    expect(s.reason).toBe("plateau");
    expect(s.fromKg).toBe(77);
    expect(s.targetKg).toBe(70); // 77 × 0.9 = 69.3 → nearest 2.5
    expect(s.action).toBe("Drop to ~70 kg (−10%) and build back up");
  });

  it("frames an acute slide as ease-off, not deload math", () => {
    const s = suggestDeload(ex({ declining: true, stalledWeeks: 1 }))!;
    expect(s.reason).toBe("decline");
    expect(s.action).toBe("Ease back to ~70 kg and rebuild — don't grind through it");
  });

  it("falls back to a weight-free message when PR detail is missing", () => {
    const s = suggestDeload(ex({ lastPRDetail: "" }))!;
    expect(s.fromKg).toBeNull();
    expect(s.targetKg).toBeNull();
    expect(s.action).toBe("Deload ~10% and build back up");
  });

  it("stays weight-free for assisted lifts — a %BW PR detail has no kg to deload to", () => {
    // Assisted lastPRDetail reads in %BW ("79.8% BW × 7"), so parseFromKg finds no
    // kg and the advice must NOT invent a bogus kg target (a %BW lift's raw kg is
    // exactly what the %BW axis strips out).
    const s = suggestDeload(ex({ lastPRDetail: "79.8% BW × 7" }))!;
    expect(s.fromKg).toBeNull();
    expect(s.targetKg).toBeNull();
    expect(s.action).toBe("Deload ~10% and build back up");
  });
});
