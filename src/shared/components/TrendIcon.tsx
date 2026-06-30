export type TrendDir = "up" | "down" | "flat" | "alert";

/**
 * Unified trend / direction glyph. Lucide-style stroked SVG that inherits
 * colour from `currentColor`, so each call-site controls its own semantics
 * (e.g. up = accent for TDEE, up = muted for "recovering").
 *
 *   up    → trending-up   (rising zig-zag)
 *   down  → trending-down (falling zig-zag)
 *   flat  → minus         (steady)
 *   alert → triangle      (data check / uncertain)
 */
export function TrendIcon({
  dir,
  size = 13,
  strokeWidth = 2.25,
}: {
  dir: TrendDir;
  size?: number;
  strokeWidth?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    style: { flex: "none" as const, display: "block" },
  };

  switch (dir) {
    case "up":
      return (
        <svg {...common}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
          <polyline points="16 17 22 17 22 11" />
        </svg>
      );
    case "flat":
      return (
        <svg {...common}>
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3.5 21 19a1.6 1.6 0 0 1-1.4 2.4H4.4A1.6 1.6 0 0 1 3 19Z" />
          <line x1="12" y1="9.5" x2="12" y2="13.5" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
  }
}
