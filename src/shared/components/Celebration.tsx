import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";

export type CelebVariant = "logged" | "double-hit" | "pr";

export interface CelebPayload {
  variant: CelebVariant;
  /** Override the default headline. */
  title?: string;
  /** Override the default subtitle (e.g. the PR weight). */
  sub?: string;
}

const DEFAULTS: Record<CelebVariant, { icon: React.ReactNode; title: string; sub: string; gold: boolean }> = {
  "logged": { icon: "✅", title: "Logged", sub: "Entry saved", gold: false },
  "double-hit": { icon: "🎯", title: "Double Hit!", sub: "Under budget & protein floor cleared", gold: true },
  "pr": { icon: "🏆", title: "New PR!", sub: "Personal record", gold: true },
};

// ── Celebration confetti ──────────────────────────────────────────────────────
function Celebration({ variant, title, sub, closing }: CelebPayload & { closing?: boolean }) {
  const d = DEFAULTS[variant];
  const count = variant === "logged" ? 18 : 34;
  return createPortal(
    <div
      className={`save-celebration v-${variant}${d.gold ? " is-gold" : ""}${closing ? " is-closing" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="celeb-confetti" aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="celeb-card">
        <span className="celeb-icon" aria-hidden>{d.icon}</span>
        <strong>{title ?? d.title}</strong>
        <span className="celeb-sub">{sub ?? d.sub}</span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Fire-and-forget celebration overlay. Call `celebrate(...)` to show the
 * confetti card; it auto-dismisses after `durationMs` and plays its exit
 * animation. Render `node` somewhere in the component tree.
 */
export function useCelebration(durationMs = 2000) {
  const [active, setActive] = useState<CelebPayload | null>(null);
  const t = useExitTransition(active !== null);
  const payloadRef = useRef<CelebPayload | null>(active);
  if (active) payloadRef.current = active;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrate = useCallback((payload: CelebVariant | CelebPayload) => {
    setActive(typeof payload === "string" ? { variant: payload } : payload);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(null), durationMs);
  }, [durationMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const node = t.mounted && payloadRef.current
    ? <Celebration {...payloadRef.current} closing={t.closing} />
    : null;

  return { celebrate, node };
}
