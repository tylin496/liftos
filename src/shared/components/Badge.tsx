import type { ReactNode } from "react";
import "./badge.css";

export type BadgeTone = "gold" | "good" | "bad" | "neutral";

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
    <span className={["status-text", `status-text--${tone}`, className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
