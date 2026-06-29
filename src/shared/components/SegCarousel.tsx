import { useRef } from "react";

interface Props {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
  children: React.ReactNode[];
}

export function SegCarousel({ tabs, active, onChange, children }: Props) {
  const idx = tabs.findIndex((t) => t.id === active);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 44 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    if (dx < 0 && idx < tabs.length - 1) onChange(tabs[idx + 1].id);
    else if (dx > 0 && idx > 0) onChange(tabs[idx - 1].id);
  }

  return (
    <>
      <div className="seg" role="tablist">
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

      <div
        className="seg-carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
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
