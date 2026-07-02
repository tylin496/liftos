export type TabId = "overview" | "training" | "nutrition" | "health";

/* "Glass" sheen on the inactive glyphs. A currentColor gradient runs top→bottom
   across the full glyph (userSpaceOnUse, y 2→22 of the 24 viewBox). The two
   lower stops fade via CSS vars (--tab-sheen-mid/base): inactive icons carry the
   fade so the saturated glass bleeds up into them (reads as "dimmed / not fully
   lit"), while layout.css resets the vars to 1 on the active tab so the selected
   glyph is flat, solid accent — fully lit. Reads off currentColor so it tracks
   each icon's colour; one <defs> per icon (ids must stay unique so currentColor
   resolves to that icon's own colour). */
function GlassGradient({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22">
        <stop offset="0" stopColor="currentColor" />
        <stop offset="0.55" stopColor="currentColor" stopOpacity="var(--tab-sheen-mid, 1)" />
        <stop offset="1" stopColor="currentColor" stopOpacity="var(--tab-sheen-base, 1)" />
      </linearGradient>
    </defs>
  );
}

const TABS: { id: TabId; label: string; icon: JSX.Element }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <GlassGradient id="tabGlassOverview" />
        <path d="M4 11.5L12 4l8 7.5" stroke="url(#tabGlassOverview)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" stroke="url(#tabGlassOverview)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <GlassGradient id="tabGlassTraining" />
        <rect x="2.5" y="9.5" width="3" height="5" rx="1" fill="url(#tabGlassTraining)" />
        <rect x="18.5" y="9.5" width="3" height="5" rx="1" fill="url(#tabGlassTraining)" />
        <rect x="5.5" y="7.5" width="2.5" height="9" rx="1" fill="url(#tabGlassTraining)" />
        <rect x="16" y="7.5" width="2.5" height="9" rx="1" fill="url(#tabGlassTraining)" />
        <rect x="8" y="11" width="8" height="2" rx="1" fill="url(#tabGlassTraining)" />
      </svg>
    ),
  },
  {
    id: "nutrition",
    label: "Nutrition",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <GlassGradient id="tabGlassNutrition" />
        <path d="M7 3v6M10 3v6M13 3v6" stroke="url(#tabGlassNutrition)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7 9c0 2.1 1.3 3 3 3s3-.9 3-3" stroke="url(#tabGlassNutrition)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M10 12v9" stroke="url(#tabGlassNutrition)" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17 3c1.8.3 2.6 2.4 2.6 5s-1 5.3-2.6 6" stroke="url(#tabGlassNutrition)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 14v7" stroke="url(#tabGlassNutrition)" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <GlassGradient id="tabGlassHealth" />
        <path d="M3 13h3.2l1.8-4 3 8 2-6.5 1.4 2.5H21" stroke="url(#tabGlassHealth)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
  return (
    <nav className="tabbar" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tabbar-item${active === t.id ? " is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <span className="tabbar-icon">{t.icon}</span>
          <span className="tabbar-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
