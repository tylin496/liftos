// Single source of truth for haptic feedback across the app. Previously this
// lived as three near-identical copies (training/ExerciseCard, nutrition/today,
// nutrition/history) with drifting signatures, plus a raw navigator.vibrate(12)
// call in Shell.
//
// NOTE: iOS Safari / installed PWAs do NOT implement navigator.vibrate, so every
// call here is a silent no-op on iPhone. These patterns only reach Android today.
// Kept centralised so that if/when a WebKit haptics path appears we swap it once.

const PATTERNS = {
  tap: 8,
  select: 12,
  success: [18, 30, 18],
  warning: [28, 40, 28],
  error: [50, 40, 50],
} satisfies Record<string, number | number[]>;

export type HapticKind = keyof typeof PATTERNS;

export function haptic(kind: HapticKind = "tap"): void {
  if (!navigator.vibrate) return;
  navigator.vibrate(PATTERNS[kind]);
}
