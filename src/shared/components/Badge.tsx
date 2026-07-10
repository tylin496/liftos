import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "gold" | "good" | "bad" | "warn" | "neutral";

export function Badge({
  tone = "neutral",
  pill = false,
  mark,
  className,
  children,
}: {
  tone?: BadgeTone;
  pill?: boolean;
  /** Optional verdict glyph (e.g. ✓ / !) that REPLACES the pill's status dot —
   *  a worded verdict chip (the Journey pace pill) leads with the mark instead
   *  of the ambient dot. Inherits the tone's text colour + gold-glow. */
  mark?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "status-text",
        `status-text--${tone}`,
        pill ? "status-text--pill" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {pill &&
        (mark != null ? (
          <span className="status-text-mark" aria-hidden>{mark}</span>
        ) : (
          <span className="status-text-dot" />
        ))}
      {children}
    </span>
  );
}
