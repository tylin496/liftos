export type TabId = "overview" | "training" | "nutrition" | "health";

const TABS: { id: TabId; label: string; icon: JSX.Element }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />
      </svg>
    ),
  },
  {
    id: "training",
    label: "Training",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.6 6.7l-1.3-1.3a1 1 0 0 0-1.4 0l-.7.7-1-1a1 1 0 0 0-1.4 1.4l1 1L8.9 13.5l-1-1a1 1 0 1 0-1.4 1.4l.7.7-.7.7a1 1 0 0 0 0 1.4l1.3 1.3a1 1 0 0 0 1.4 0l.7-.7 1 1a1 1 0 0 0 1.4-1.4l-1-1 5.5-5.5 1 1a1 1 0 0 0 1.4-1.4l-1-1 .7-.7a1 1 0 0 0 0-1.4Z" />
      </svg>
    ),
  },
  {
    id: "nutrition",
    label: "Nutrition",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5 2 8a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3c0-3 2-5 2-8a7 7 0 0 0-7-7Zm-1 16h2v2h-2v-2Z" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 13h3l2 5 4-12 2 7 1.5-3H21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
