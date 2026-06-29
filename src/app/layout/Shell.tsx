import { useEffect, useRef, useState } from "react";
import type { Session } from "@shared/lib/auth";
import { OverviewPage } from "@features/overview/page";
import { TrainingPage } from "@features/training/page";
import { NutritionPage } from "@features/nutrition/page";
import { HealthPage } from "@features/health/page";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { HeaderActionProvider } from "./HeaderActionContext";
import { NavContext } from "./NavContext";
import { TabActivityContext } from "./TabActivityContext";
import "./layout.css";

const PAGES: Record<TabId, () => JSX.Element> = {
  overview: OverviewPage,
  training: TrainingPage,
  nutrition: NutritionPage,
  health: HealthPage,
};

const TAB_ORDER: TabId[] = ["overview", "training", "nutrition", "health"];

export function Shell({ session }: { session: Session }) {
  const [tab, setTab] = useState<TabId>("overview");
  // Pages that have been visited at least once — we keep them mounted
  const [visited, setVisited] = useState<Set<TabId>>(new Set(["overview"]));
  // Incremented each time the user navigates TO a tab — pages re-fetch on change
  const [tabVersions, setTabVersions] = useState<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );

  function switchTab(next: TabId) {
    if (next !== tab) {
      navigator.vibrate?.(12);
      setVisited((prev) => new Set([...prev, next]));
      setTabVersions((prev) => ({ ...prev, [next]: prev[next] + 1 }));
    }
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const contentRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const axisLocked = useRef<"h" | "v" | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      axisLocked.current = null;
    }

    function onTouchMove(e: TouchEvent) {
      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;
      if (axisLocked.current === null) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 10) {
          axisLocked.current = "h";
        } else if (Math.abs(dy) > 10) {
          axisLocked.current = "v";
        }
      }
      if (axisLocked.current === "h") e.preventDefault();
    }

    function onTouchEnd(e: TouchEvent) {
      if (axisLocked.current !== "h") return;
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(dx) < 44) return;
      setTab((prev) => {
        const idx = TAB_ORDER.indexOf(prev);
        let next = prev;
        if (dx < 0 && idx < TAB_ORDER.length - 1) next = TAB_ORDER[idx + 1];
        else if (dx > 0 && idx > 0) next = TAB_ORDER[idx - 1];
        if (next !== prev) window.scrollTo({ top: 0, behavior: "instant" });
        return next;
      });
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return (
    <HeaderActionProvider>
      <NavContext.Provider value={switchTab}>
        <div className="shell">
          <Header user={session.user} tab={tab} />
          <main ref={contentRef} className="shell-content">
            {TAB_ORDER.map((tabId) => {
              if (!visited.has(tabId)) return null;
              const Page = PAGES[tabId];
              return (
                <TabActivityContext.Provider key={tabId} value={tabVersions[tabId]}>
                  <div style={tabId !== tab ? { display: "none" } : undefined}>
                    <Page />
                  </div>
                </TabActivityContext.Provider>
              );
            })}
          </main>
          <TabBar active={tab} onChange={switchTab} />
        </div>
      </NavContext.Provider>
    </HeaderActionProvider>
  );
}
