export type TabId = "overview" | "training" | "nutrition" | "health";

const TABS: { id: TabId; label: string; icon: JSX.Element }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9.5v5M20 9.5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7 7.5v9M17 7.5v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "nutrition",
    label: "Nutrition",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3v6M10 3v6M13 3v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7 9c0 2.1 1.3 3 3 3s3-.9 3-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M10 12v9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17 3c1.8.3 2.6 2.4 2.6 5s-1 5.3-2.6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 14v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 13h3.2l1.8-4 3 8 2-6.5 1.4 2.5H21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
