import { useEffect, useRef, type CSSProperties } from "react";

export type TabId = "overview" | "training" | "nutrition" | "health";

/* Flat glyphs, iOS-style: inactive icons are a plain secondary ink and the
   active one flips to the accent (colour handled in layout.css). No per-icon
   gradient — the material bar + colour hierarchy carry the look. Strokes are
   1.6 to sit closer to SF Symbols' regular weight. Selected state swaps to a
   filled variant (SF Symbols convention) where the glyph has one; Training is
   already fill-based (just grows slightly) and Health's waveform has no fill
   form so it just thickens. */
const TABS: { id: TabId; label: string; icon: JSX.Element; iconActive: JSX.Element }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9L12 5.3z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="9.5" width="3" height="5" rx="1" fill="currentColor" />
        <rect x="18.5" y="9.5" width="3" height="5" rx="1" fill="currentColor" />
        <rect x="5.5" y="7.5" width="2.5" height="9" rx="1" fill="currentColor" />
        <rect x="16" y="7.5" width="2.5" height="9" rx="1" fill="currentColor" />
        <rect x="8" y="11" width="8" height="2" rx="1" fill="currentColor" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2" y="9" width="3.5" height="6" rx="1" fill="currentColor" />
        <rect x="18.5" y="9" width="3.5" height="6" rx="1" fill="currentColor" />
        <rect x="5.3" y="7" width="2.8" height="10" rx="1" fill="currentColor" />
        <rect x="15.9" y="7" width="2.8" height="10" rx="1" fill="currentColor" />
        <rect x="7.8" y="10.7" width="8.4" height="2.6" rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "nutrition",
    label: "Nutrition",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3v6M10 3v6M13 3v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M7 9c0 2.1 1.3 3 3 3s3-.9 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 12v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17 3c1.8.3 2.6 2.4 2.6 5s-1 5.3-2.6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 14v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6.2 3v6.4c0 2.3 1.5 3.6 3.8 3.6s3.8-1.3 3.8-3.6V3H12v5.5h-.5V3h-1v5.5h-.5V3h-1v5.5H8.5V3H6.2z"
          fill="currentColor"
        />
        <rect x="9.25" y="12.5" width="1.5" height="8.5" rx="0.75" fill="currentColor" />
        <path
          d="M17 3c1.8.3 2.6 2.4 2.6 5s-1 5.3-2.6 6v7h-1V3z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 13h3.2l1.8-4 3 8 2-6.5 1.4 2.5H21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    iconActive: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 13h3.2l1.8-4 3 8 2-6.5 1.4 2.5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  const activeIdx = Math.max(0, TABS.findIndex((t) => t.id === active));
  const thumbRef = useRef<HTMLSpanElement>(null);
  const prevIdx = useRef(activeIdx);

  // Retrigger the gel squash whenever the active tab changes (not on mount).
  // Removing/reflowing/re-adding the class restarts the CSS animation.
  useEffect(() => {
    if (prevIdx.current === activeIdx) return;
    prevIdx.current = activeIdx;
    const t = thumbRef.current;
    if (!t) return;
    t.classList.remove("is-morphing");
    void t.offsetWidth;
    t.classList.add("is-morphing");
  }, [activeIdx]);

  return (
    <nav
      className="tabbar"
      role="tablist"
      style={{ "--tab-idx": activeIdx } as CSSProperties}
    >
      <span className="tabbar-thumb" ref={thumbRef} aria-hidden="true">
        <span className="tabbar-thumb-fill" />
      </span>
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tabbar-item${active === t.id ? " is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <span className="tabbar-icon">{active === t.id ? t.iconActive : t.icon}</span>
          <span className="tabbar-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
