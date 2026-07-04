import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";

export type CelebVariant = "logged" | "double-hit" | "pr" | "milestone";

export interface CelebPayload {
  variant: CelebVariant;
  /** Override the default headline. */
  title?: string;
  /** Override the default subtitle (e.g. the PR weight). */
  sub?: string;
  /** Stay on screen (with backdrop + confirm button) until the user dismisses,
      instead of auto-fading. Used by the tenure milestone — a "big moment". */
  sticky?: boolean;
}

// Confetti palettes — dominant stops use theme tokens so they track light/dark;
// the supporting shades are fixed metallic/warm tints.
const GOLD_PAL = ["var(--gold)", "#d4af37", "#f0d884", "#b8860b", "#f7ead0"];
const ACCENT_PAL = ["var(--accent)", "var(--accent-strong)", "#f7a07d", "#f5d9cc", "#e8683a"];

const DEFAULTS: Record<
  CelebVariant,
  { title: string; sub: string; gold: boolean; tone: string; count: number; pal: string[] }
> = {
  "logged": { title: "Logged", sub: "Entry saved", gold: false, tone: "var(--good)", count: 20, pal: ACCENT_PAL },
  "double-hit": { title: "Double Hit!", sub: "Under budget & protein floor cleared", gold: true, tone: "var(--gold)", count: 34, pal: GOLD_PAL },
  "pr": { title: "New PR!", sub: "Personal record", gold: true, tone: "var(--gold)", count: 34, pal: GOLD_PAL },
  "milestone": { title: "Milestone", sub: "Training milestone", gold: true, tone: "var(--gold)", count: 64, pal: GOLD_PAL },
};

// Crafted SVG badge glyphs (draw-on check / bullseye / trophy / star) — colored by --tone.
const GLYPHS: Record<CelebVariant, React.ReactNode> = {
  "logged": (
    <svg viewBox="0 0 66 66" aria-hidden>
      <path className="celeb-glyph-check" d="M20 34 L29 43 L47 24" />
    </svg>
  ),
  "double-hit": (
    <svg viewBox="0 0 66 66" aria-hidden>
      <g className="celeb-glyph-fill">
        <circle cx="33" cy="33" r="15" fill="none" stroke="var(--tone)" strokeWidth="4" />
        <circle cx="33" cy="33" r="8" fill="none" stroke="var(--tone)" strokeWidth="4" />
      </g>
      <circle className="celeb-dot" cx="33" cy="33" r="3.6" fill="var(--tone)" />
    </svg>
  ),
  "pr": (
    <svg viewBox="0 0 66 66" aria-hidden>
      <path
        className="celeb-glyph-fill"
        d="M25 18 h16 v9 a8 8 0 0 1 -16 0 z M25 20 h-5 a4 4 0 0 0 0 8 h5 M41 20 h5 a4 4 0 0 1 0 8 h-5 M31 34 h4 v6 h-4 z M26 40 h14 v3 h-14 z M28 43 h10 l1.5 5 h-13 z"
      />
      <rect className="celeb-shine" x="22" y="14" width="6" height="34" rx="3" transform="rotate(16 33 33)" />
    </svg>
  ),
  "milestone": (
    <svg viewBox="0 0 66 66" aria-hidden>
      <path
        className="celeb-glyph-fill"
        d="M33 15 l5.3 11.4 12.5 1.6 -9.2 8.6 2.4 12.4 -11-6.1 -11 6.1 2.4-12.4 -9.2-8.6 12.5-1.6z"
      />
      <rect className="celeb-shine" x="20" y="14" width="6" height="38" rx="3" transform="rotate(18 33 33)" />
    </svg>
  ),
};

/** Deterministic pseudo-random in [0,1) — keeps confetti varied but stable per index. */
function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Per-particle geometry: burst out from center, then droop under gravity. */
function particleStyle(i: number, count: number, pal: string[]): React.CSSProperties {
  const ang = (i / count) * Math.PI * 2 + (rand(i) - 0.5) * 0.7;
  const launch = 70 + rand(i + 3) * 80;
  const px = Math.cos(ang) * launch;
  const py = Math.sin(ang) * launch;
  const gravity = 150 + rand(i + 7) * 180;
  const ex = px * 1.35 + (rand(i + 11) - 0.5) * 40;
  const ey = py * 0.6 + gravity;
  const rot = (rand(i + 5) - 0.5) * 900;
  const circle = rand(i + 9) > 0.62; // some round sequins among the strips
  const sz = 5 + Math.round(rand(i + 13) * 5);
  const w = circle ? sz : sz - 1;
  const h = circle ? sz : sz + 4;
  return {
    width: `${w}px`,
    height: `${h}px`,
    marginTop: `${-h / 2}px`,
    marginLeft: `${-w / 2}px`,
    borderRadius: circle ? "50%" : "1.5px",
    background: pal[i % pal.length],
    "--px": `${px.toFixed(1)}px`,
    "--py": `${py.toFixed(1)}px`,
    "--ex": `${ex.toFixed(1)}px`,
    "--ey": `${ey.toFixed(1)}px`,
    "--rot": `${rot.toFixed(0)}deg`,
    "--op": (0.6 + rand(i + 2) * 0.4).toFixed(2),
    animationDelay: `${Math.round(rand(i) * 90)}ms`,
  } as React.CSSProperties;
}

/** A single continuously-falling piece for the sticky milestone "rain" layer. */
function rainStyle(i: number, pal: string[]): React.CSSProperties {
  const circle = rand(i + 9) > 0.6;
  const sz = 6 + Math.round(rand(i + 13) * 5);
  const w = circle ? sz : sz - 2;
  const h = circle ? sz : sz + 5;
  const dur = 2.6 + rand(i + 3) * 2.2;
  return {
    left: `${(rand(i) * 100).toFixed(1)}%`,
    width: `${w}px`,
    height: `${h}px`,
    borderRadius: circle ? "50%" : "1.5px",
    background: pal[i % pal.length],
    "--rot": `${((rand(i + 7) - 0.5) * 720).toFixed(0)}deg`,
    "--op": (0.5 + rand(i + 2) * 0.4).toFixed(2),
    animationDuration: `${dur.toFixed(2)}s`,
    animationDelay: `${(rand(i + 5) * -4).toFixed(2)}s`, // negative → already mid-fall on mount
  } as React.CSSProperties;
}

// ── Celebration confetti ──────────────────────────────────────────────────────
function Celebration({
  variant,
  title,
  sub,
  sticky,
  closing,
  onDismiss,
}: CelebPayload & { closing?: boolean; onDismiss: () => void }) {
  const d = DEFAULTS[variant];
  return createPortal(
    <div
      className={`save-celebration v-${variant}${d.gold ? " is-gold" : ""}${sticky ? " is-sticky" : ""}${closing ? " is-closing" : ""}`}
      role="status"
      aria-live="polite"
      onClick={sticky ? onDismiss : undefined}
    >
      <div className="celeb-confetti" aria-hidden>
        {Array.from({ length: d.count }, (_, i) => (
          <span key={i} style={particleStyle(i, d.count, d.pal)} />
        ))}
      </div>
      {sticky && (
        <div className="celeb-rain" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} style={rainStyle(i, d.pal)} />
          ))}
        </div>
      )}
      <div
        className="celeb-card"
        style={{ "--tone": d.tone } as React.CSSProperties}
        onClick={sticky ? (e) => e.stopPropagation() : undefined}
      >
        <span className="celeb-badge" aria-hidden>
          {variant === "milestone" && <span className="celeb-rays" />}
          <span className="celeb-disc" />
          <span className="celeb-ring" />
          {d.gold && <span className="celeb-ring r2" />}
          {GLYPHS[variant]}
        </span>
        <strong>{title ?? d.title}</strong>
        <span className="celeb-sub">{sub ?? d.sub}</span>
        {sticky && (
          <button type="button" className="celeb-confirm" onClick={onDismiss}>
            Nice
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Fire-and-forget celebration overlay. Call `celebrate(...)` to show the
 * confetti card; it auto-dismisses after `durationMs` and plays its exit
 * animation — unless the payload is `sticky`, which waits for a user tap.
 * Render `node` somewhere in the component tree.
 */
export function useCelebration(durationMs = 2000) {
  const [active, setActive] = useState<CelebPayload | null>(null);
  const t = useExitTransition(active !== null);
  const payloadRef = useRef<CelebPayload | null>(active);
  if (active) payloadRef.current = active;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrate = useCallback((payload: CelebVariant | CelebPayload) => {
    const p = typeof payload === "string" ? { variant: payload } : payload;
    setActive(p);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!p.sticky) {
      timer.current = setTimeout(() => setActive(null), durationMs);
    }
  }, [durationMs]);

  const dismiss = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setActive(null);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const node = t.mounted && payloadRef.current
    ? <Celebration {...payloadRef.current} closing={t.closing} onDismiss={dismiss} />
    : null;

  return { celebrate, node };
}
