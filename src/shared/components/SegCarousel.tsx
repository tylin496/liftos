interface Props {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
  children: React.ReactNode[];
}

// Segments switch by tapping the seg pills only — no swipe, so horizontal
// swipe stays available for the page's own gesture (split/date/tab).
export function SegCarousel({ tabs, active, onChange, children }: Props) {
  const idx = tabs.findIndex((t) => t.id === active);

  return (
    <>
      <div
        className="seg"
        role="tablist"
        style={{ "--seg-idx": idx, "--seg-n": tabs.length } as React.CSSProperties}
      >
        <span className="seg-thumb" aria-hidden />
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={`seg-item${active === t.id ? " is-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="seg-count">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      <div className="seg-carousel-viewport">
        <div
          className="seg-carousel-track"
          style={{ transform: `translateX(${-idx * 100}%)` }}
        >
          {children.map((child, i) => (
            <div key={i} className="seg-carousel-panel">
              {child}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
