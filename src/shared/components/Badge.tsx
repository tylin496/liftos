import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "gold" | "good" | "bad" | "warn" | "neutral";

export function Badge({
  tone = "neutral",
  pill = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  pill?: boolean;
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
      {pill && <span className="status-text-dot" />}
      {children}
    </span>
  );
}
