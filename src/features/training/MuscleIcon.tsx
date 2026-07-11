import type { MuscleGroup } from "./muscleGroup";

// Muscle-group icon system — design-handoff Turn 9 (+ Turn 10 position fix).
// One shared human-silhouette template per orientation, muscle highlighted in
// brand ember. Front vs. back is signalled two ways so it survives small
// sizes: a spine/glute centre-line (blurs at ~20px) AND highlight POSITION
// (Biceps high / Triceps low; Quads high / Hamstrings low) — the load-bearing
// cue is position, not the line. Never redraw the body: extending the set
// means adding one bilaterally-symmetric highlight to an existing template.

export type MuscleIconName = Exclude<MuscleGroup, "unknown">;

// Handoff's skeleton grey (#a0a0a6) mapped to the app's own quiet-ink token so
// it resolves correctly in dark mode instead of a fixed light-theme hex.
const SKELETON = "var(--ink-4)";
const HI_FILL = "var(--accent)";
const HI_STROKE = "var(--accent-strong)";

const UPPER_BODY_D =
  "M9.9 6.2C7.9 6.5 6.3 7.5 5.5 9.2L3.9 14.6M14.1 6.2c2 .3 3.6 1.3 4.4 3l1.6 5.4M7.9 9.6l.4 10M16.1 9.6l-.4 10";
const SPINE_D = "M12 6.3v12.8";
const LOWER_FRONT_D = "M7.5 3.5h9M9.8 16.5 9.4 21M14.2 16.5l.4 4.5";
const LOWER_BACK_D = "M7.5 4.2c1.3 1 2.9 1.5 4.5 1.5s3.2-.5 4.5-1.5M9.6 17 9.3 21M14.4 17l.3 4";

type Highlight = readonly [string, string];

const HIGHLIGHTS: Partial<Record<MuscleIconName, Highlight>> = {
  chest: [
    "M9.3 8.3c.9-.4 1.8-.6 2.5-.5v2.3c0 1.2-.8 2-2 2-.8 0-1.5-.6-1.6-1.5z",
    "M14.7 8.3c-.9-.4-1.8-.6-2.5-.5v2.3c0 1.2.8 2 2 2 .8 0 1.5-.6 1.6-1.5z",
  ],
  shoulders: [
    "M4.8 9.6c-.3-2 1-3.6 2.9-4 1.1-.3 2.1 0 2.9.6-.1 1.9-1.4 3.4-3.2 3.9-1 .3-1.9.1-2.6-.5z",
    "M19.2 9.6c.3-2-1-3.6-2.9-4-1.1-.3-2.1 0-2.9.6.1 1.9 1.4 3.4 3.2 3.9 1 .3 1.9.1 2.6-.5z",
  ],
  biceps: [
    "M3.8 12.6c-.5-1.7-.1-3.3 1.1-4.4.8-.7 1.8-.9 2.7-.6.3 1.7-.2 3.4-1.4 4.6-.7.7-1.6.9-2.4.4z",
    "M20.2 12.6c.5-1.7.1-3.3-1.1-4.4-.8-.7-1.8-.9-2.7-.6-.3 1.7.2 3.4 1.4 4.6.7.7 1.6.9 2.4.4z",
  ],
  triceps: [
    "M3.6 15.1c-.6-1.9-.2-3.7 1.1-4.9.8-.7 1.8-1 2.7-.7.4 1.9-.1 3.8-1.4 5.2-.7.7-1.6.9-2.4.4z",
    "M20.4 15.1c.6-1.9.2-3.7-1.1-4.9-.8-.7-1.8-1-2.7-.7-.4 1.9.1 3.8 1.4 5.2.7.7 1.6.9 2.4.4z",
  ],
  back: [
    "M9.1 8.4l2.4 1v6l-1.9-1.6c-.8-1.6-.9-3.5-.5-5.4z",
    "M14.9 8.4l-2.4 1v6l1.9-1.6c.8-1.6.9-3.5.5-5.4z",
  ],
  quads: [
    "M7.4 5c1.1-.7 2.3-.7 3.2 0 .5 3 .2 6-.9 8.9-.8.6-1.8.6-2.5-.1-.6-2.9-.5-5.9.2-8.8z",
    "M16.6 5c-1.1-.7-2.3-.7-3.2 0-.5 3-.2 6 .9 8.9.8.6 1.8.6 2.5-.1.6-2.9.5-5.9-.2-8.8z",
  ],
  hamstrings: [
    "M7.6 9.4c1-.5 2.1-.5 2.9.1.4 2.7.1 5.3-.8 7.8-.7.5-1.6.5-2.2-.1-.5-2.6-.4-5.2.1-7.8z",
    "M16.4 9.4c-1-.5-2.1-.5-2.9.1-.4 2.7-.1 5.3.8 7.8.7.5 1.6.5 2.2-.1.5-2.6.4-5.2-.1-7.8z",
  ],
};

type Template = "upper-front" | "upper-back" | "lower-front" | "lower-back";

// Which body template each muscle sits on. glutes/calves/abs have no hifi
// highlight in the Turn 9 spec — they render skeleton-only on their nearest
// template until a highlight is authored per the handoff's "extending the
// set" rule (never redraw the body, just add one symmetric highlight).
const TEMPLATE: Record<MuscleIconName, Template> = {
  chest: "upper-front",
  shoulders: "upper-front",
  biceps: "upper-front",
  abs: "upper-front",
  triceps: "upper-back",
  back: "upper-back",
  quads: "lower-front",
  calves: "lower-front",
  hamstrings: "lower-back",
  glutes: "lower-back",
};

export function MuscleIcon({ name, size = 24, className }: { name: MuscleIconName; size?: number; className?: string }) {
  const template = TEMPLATE[name];
  const isUpper = template.startsWith("upper");
  const isBack = template.endsWith("back");
  const highlight = HIGHLIGHTS[name];

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {isUpper ? (
        <>
          <circle cx="12" cy="3.9" r="2.15" stroke={SKELETON} strokeWidth="1.75" />
          <path
            d={isBack ? `${UPPER_BODY_D}${SPINE_D}` : UPPER_BODY_D}
            stroke={SKELETON}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <path
          d={isBack ? LOWER_BACK_D : LOWER_FRONT_D}
          stroke={SKELETON}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {highlight && (
        <>
          <path d={highlight[0]} fill={HI_FILL} stroke={HI_STROKE} strokeWidth="0.8" strokeLinejoin="round" />
          <path d={highlight[1]} fill={HI_FILL} stroke={HI_STROKE} strokeWidth="0.8" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
