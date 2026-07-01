import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "gold" | "good" | "bad" | "blue" | "neutral";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={["badge", `badge--${tone}`, className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
