import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Session } from "@shared/lib/auth";
import { OverviewPage } from "@features/overview/page";
import { TrainingPage } from "@features/training/page";
import { NutritionPage } from "@features/nutrition/page";
import { HealthPage } from "@features/health/page";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { HeaderActionProvider } from "./HeaderActionContext";
import { HeaderTitleProvider } from "./HeaderTitleContext";
import { NavContext } from "./NavContext";
import { TabActivityContext } from "./TabActivityContext";
import { ToastProvider } from "@shared/components/Toast";
import { NutritionConfigProvider } from "@features/nutrition/NutritionConfigContext";
import "./layout.css";

const PAGES: Record<TabId, () => JSX.Element> = {
  overview: OverviewPage,
  training: TrainingPage,
  nutrition: NutritionPage,
  health: HealthPage,
};

const TAB_ORDER: TabId[] = ["overview", "training", "nutrition", "health"];

const SLIDE_MS = 320;

export function Shell({ session }: { session: Session }) {
  const [tab, setTab] = useState<TabId>(
    () => (localStorage.getItem("active-tab") as TabId) ?? "overview",
  );
  // Pages that have been visited at least once — we keep them mounted
  const [visited, setVisited] = useState<Set<TabId>>(new Set([tab]));
  // Incremented each time the user navigates TO a tab — pages re-fetch on change
  const [tabVersions, setTabVersions] = useState<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  const [headerHidden, setHeaderHidden] = useState(false);
  // True once the page scrolls off the top — drives the header's glass material
  const [scrolled, setScrolled] = useState(false);
  const lastScrollY = useRef(0);
  // Running sum of scroll movement in the current direction; gates header hide
  const hideAccum = useRef(0);

  // Horizontal tab transition. `to` is the neighbour sliding in; `dir` is +1
  // when moving to a higher-index tab (new page enters from the right), −1 for
  // the reverse. `dx` tracks the live finger offset (0 while a tap-triggered
  // slide plays out). `settling` disables the finger-follow transition:none so
  // the CSS transition animates the snap.
  const [slide, setSlide] = useState<
    { to: TabId; dir: 1 | -1; dx: number; settling: boolean } | null
  >(null);
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const settleTimer = useRef<number | null>(null);

  // Finalize a settle animation deterministically after it plays. We use a
  // timer rather than transitionend because descendant transform transitions
  // (progress bars, count-ups) bubble up and would fire the handler early.
  function scheduleFinalize() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      const s = slideRef.current;
      if (s && s.dx !== 0) commitTab(s.to);
      setSlide(null);
    }, SLIDE_MS + 20);
  }

  function commitTab(next: TabId) {
    if (next !== tab) {
      navigator.vibrate?.(12);
      setVisited((prev) => new Set([...prev, next]));
      setTabVersions((prev) => ({ ...prev, [next]: prev[next] + 1 }));
    }
    localStorage.setItem("active-tab", next);
    setTab(next);
    setHeaderHidden(false);
    setScrolled(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // Programmatic (tab-bar tap) navigation — plays the same slide animation as a
  // swipe by kicking off from dx:0 and letting the CSS transition run.
  function switchTab(next: TabId) {
    if (next === tab) return;
    if (slideRef.current) { commitTab(next); return; }
    const dir: 1 | -1 = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
    setVisited((prev) => new Set([...prev, next]));
    window.scrollTo({ top: 0, behavior: "instant" });
    // Place the incoming panel off-screen with no transition, then flip to the
    // target on a timer so the browser paints the start frame first. setTimeout
    // (not rAF) so the animation still completes if the tab is backgrounded.
    setSlide({ to: next, dir, dx: 0, settling: false });
    window.setTimeout(() => {
      const width = window.innerWidth || 1;
      setSlide({ to: next, dir, dx: -dir * width, settling: true });
      scheduleFinalize();
    }, 30);
  }

  const contentRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const axisLocked = useRef<"h" | "v" | null>(null);
  const dragTo = useRef<TabId | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (slideRef.current?.settling) return; // ignore during a settle animation
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      axisLocked.current = null;
      dragTo.current = null;
    }

    function onTouchMove(e: TouchEvent) {
      if (slideRef.current?.settling) return;
      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;
      if (axisLocked.current === null) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 10) {
          axisLocked.current = "h";
          const idx = TAB_ORDER.indexOf(tab);
          const dir: 1 | -1 = dx < 0 ? 1 : -1;
          const to = TAB_ORDER[idx + dir];
          dragTo.current = to ?? null;
          if (to) window.scrollTo({ top: 0, behavior: "instant" });
        } else if (Math.abs(dy) > 10) {
          axisLocked.current = "v";
        }
      }
      if (axisLocked.current === "h") {
        e.preventDefault();
        const to = dragTo.current;
        if (!to) return; // edge tab, nothing to reveal — rubber-band handled by CSS
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        setSlide({ to, dir, dx, settling: false });
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (axisLocked.current !== "h") return;
      const to = dragTo.current;
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (!to || Math.abs(dx) < 56) {
        // Snap back to the current tab.
        if (slideRef.current) {
          setSlide((s) => (s ? { ...s, dx: 0, settling: true } : null));
          scheduleFinalize();
        }
        return;
      }
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const width = window.innerWidth || 1;
      setSlide({ to, dir, dx: -dir * width, settling: true });
      scheduleFinalize();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [tab]);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      setScrolled(y > 4);
      // Accumulate scroll in the current direction; reset when it flips.
      // Hiding needs sustained downward scroll (slow to hide), while a small
      // upward nudge brings the header straight back (quick to reveal).
      if (Math.sign(delta) !== Math.sign(hideAccum.current)) hideAccum.current = 0;
      hideAccum.current += delta;
      if (y < 140) {
        setHeaderHidden(false);
      } else if (hideAccum.current > 90) {
        setHeaderHidden(true);
      } else if (hideAccum.current < -36) {
        setHeaderHidden(false);
      }
      lastScrollY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <ToastProvider>
    <NutritionConfigProvider>
    <HeaderActionProvider>
      <HeaderTitleProvider>
      <NavContext.Provider value={switchTab}>
        <div className={`shell${headerHidden ? " shell--header-hidden" : ""}${scrolled ? " shell--scrolled" : ""}`}>
          <Header user={session.user} tab={tab} />
          <main ref={contentRef} className={`shell-content${slide ? " is-sliding" : ""}`}>
            {TAB_ORDER.map((tabId) => {
              if (!visited.has(tabId)) return null;
              const Page = PAGES[tabId];

              let style: CSSProperties | undefined;
              if (slide) {
                const width = window.innerWidth || 1;
                const ease = slide.settling
                  ? `transform ${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                  : "none";
                if (tabId === tab) {
                  style = { transform: `translateX(${slide.dx}px)`, transition: ease };
                } else if (tabId === slide.to) {
                  style = {
                    transform: `translateX(${slide.dx + slide.dir * width}px)`,
                    transition: ease,
                  };
                } else {
                  style = { display: "none" };
                }
              } else if (tabId !== tab) {
                style = { display: "none" };
              }

              return (
                <TabActivityContext.Provider key={tabId} value={tabVersions[tabId]}>
                  <div className="tab-panel" style={style}>
                    <Page />
                  </div>
                </TabActivityContext.Provider>
              );
            })}
          </main>
          <TabBar active={tab} onChange={switchTab} />
        </div>
      </NavContext.Provider>
      </HeaderTitleProvider>
    </HeaderActionProvider>
    </NutritionConfigProvider>
    </ToastProvider>
  );
}
