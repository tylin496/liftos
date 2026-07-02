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

// Bullseye — Double Hit (under budget & protein floor cleared).
const BullseyeIcon = () => (
  <svg className="tsvg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

// Outline trophy — New PR.
const TrophyIcon = () => (
  <svg className="tsvg" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor" aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0"
    />
  </svg>
);

const DEFAULTS: Record<CelebVariant, { icon: React.ReactNode; title: string; sub: string; gold: boolean }> = {
  "logged": { icon: "✓", title: "Logged", sub: "Entry saved", gold: false },
  "double-hit": { icon: <BullseyeIcon />, title: "Double Hit!", sub: "Under budget & protein floor cleared", gold: true },
  "pr": { icon: <TrophyIcon />, title: "New PR!", sub: "Personal record", gold: true },
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
