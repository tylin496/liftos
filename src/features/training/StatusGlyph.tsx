import type { LiftStatus } from "./muscleGrid";

// Status-glyph vocabulary — design-handoff Turn 9. Lucide-style inline SVGs,
// one status = one glyph. Colour comes from the shared `.status-*` classes
// (strengthHealthCard.css §5) via currentColor, same pattern as Sparkline.

const PATHS: Record<LiftStatus, { d: string[]; strokeWidth: string }> = {
  stalled: {
    d: [
      "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
      "M12 9v4",
      "M12 17h.01",
    ],
    strokeWidth: "2",
  },
  declining: { d: ["M16 17h6v-6", "m22 17-8.5-8.5-5 5L2 7"], strokeWidth: "2.2" },
  rebounding: { d: ["M16 7h6v6", "m22 7-8.5 8.5-5-5L2 17"], strokeWidth: "2.2" },
  pr: {
    d: [
      "M6 9H4.5a2.5 2.5 0 0 1 0-5H6",
      "M18 9h1.5a2.5 2.5 0 0 0 0-5H18",
      "M4 22h16",
      "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",
      "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",
      "M18 2H6v7a6 6 0 0 0 12 0V2Z",
    ],
    strokeWidth: "2",
  },
  steady: { d: ["M20 6 9 17l-5-5"], strokeWidth: "2.2" },
};

export function StatusGlyph({ status, size = 13, className = "" }: { status: LiftStatus; size?: number; className?: string }) {
  const { d, strokeWidth } = PATHS[status];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`status-${status} ${className}`}
      aria-hidden
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
