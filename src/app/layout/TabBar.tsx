export type TabId = "overview" | "training" | "nutrition" | "health";

const TABS: { id: TabId; label: string; icon: JSX.Element }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="6.5" y="10.5" width="11" height="3" rx="0.5" />
        <rect x="3" y="5" width="3.5" height="14" rx="0.75" />
        <rect x="17.5" y="5" width="3.5" height="14" rx="0.75" />
        <rect x="1" y="7.5" width="2" height="9" rx="0.5" />
        <rect x="21" y="7.5" width="2" height="9" rx="0.5" />
      </svg>
    ),
  },
  {
    id: "nutrition",
    label: "Nutrition",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2" />
        <line x1="7" y1="11" x2="7" y2="22" />
        <path d="M21 2a5 5 0 0 0-5 5v6h3v9" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
];

const TAB_IDS = TABS.map((t) => t.id);

export function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  const activeIdx = TAB_IDS.indexOf(active);

  return (
    <nav className="tabbar" role="tablist" style={{ "--tab-idx": activeIdx } as React.CSSProperties}>
      <span className="tabbar-indicator" aria-hidden="true" />
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
