import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Session } from "@shared/lib/auth";
import { haptic } from "@shared/lib/haptics";
import { OverviewPage } from "@features/overview/page";
import { TrainingPage } from "@features/training/page";
import { NutritionPage } from "@features/nutrition/page";
import { HealthPage } from "@features/health/page";
import { TabBar, type TabId } from "./TabBar";
import { SettingsSheetProvider, useSettingsSheet } from "./SettingsSheetContext";
import { SettingsSheet } from "./SettingsSheet";
import { Splash } from "./Splash";
import { SessionUserProvider } from "./SessionContext";
import { NavContext } from "./NavContext";
import { TabActivityContext } from "./TabActivityContext";
import { PageHeaderContext, IsActiveTabContext, type PageHeader } from "./PageHeaderContext";
import { PageTopBar } from "@shared/components/PageTopBar";
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

// Wraps an index into TAB_ORDER so swiping past the last/first tab loops
// around instead of dead-ending.
function wrapIndex(i: number): number {
  return (i + TAB_ORDER.length) % TAB_ORDER.length;
}

// Single Settings sheet instance for the whole app — both PageTopBar's avatar
// (per screen) and anything else that calls openSettings() share this one.
function GlobalSettingsSheet() {
  const { open, closeSettings } = useSettingsSheet();
  return <SettingsSheet open={open} onClose={closeSettings} />;
}

export function Shell({ session }: { session: Session }) {
  const [tab, setTab] = useState<TabId>(
    () => (localStorage.getItem("active-tab") as TabId) ?? "overview",
  );
  // Which tab the bar highlights. Decoupled from `tab` (which only commits once
  // the slide animation finishes) so the orange highlight flips the instant the
  // user taps/swipes past threshold, not ~340ms later.
  const [highlight, setHighlight] = useState<TabId>(tab);
  // Pages that have been visited at least once — we keep them mounted
  const [visited, setVisited] = useState<Set<TabId>>(new Set([tab]));
  // Incremented each time the user navigates TO a tab — pages re-fetch on change
  const [tabVersions, setTabVersions] = useState<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  // Header content (eyebrow/title/onCopy), pushed up by whichever page is
  // active via usePageHeader. Rendered once, outside the sliding tab panels,
  // so the avatar/copy button stay anchored during a tab swipe — only this
  // content cross-fades (see PageTopBar).
  const [header, setHeader] = useState<PageHeader>({ eyebrow: "", title: "" });
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

  // Cold-start splash: shown once on first mount, then fades out into Overview.
  // `splash` keeps it mounted; `splashLeaving` triggers the fade-out class just
  // before unmount. reduced-motion skips straight past (300ms, no animation).
  const [splash, setSplash] = useState(true);
  const [splashLeaving, setSplashLeaving] = useState(false);
  useEffect(() => {
    if (!splash) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 300 : 1000;
    const leaveT = window.setTimeout(() => setSplashLeaving(true), hold);
    const doneT = window.setTimeout(() => setSplash(false), hold + 340);
    return () => { clearTimeout(leaveT); clearTimeout(doneT); };
  }, [splash]);
  const settleTimer = useRef<number | null>(null);
  // Every tab entry re-fetches and re-renders from a skeleton, so we always
  // land the freshly-loaded page at the top. (Per-tab scroll memory was tried
  // and reverted: the skeleton is 0-height when a restore would fire, so it
  // clamps to 0 anyway — or worse, jumps down once data loads a second later.)
  const pendingScrollTopRef = useRef(false);

  useEffect(() => {
    if (!pendingScrollTopRef.current) return;
    pendingScrollTopRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
      });
    });
  }, [tab]);

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
    setHighlight(next);
    if (next !== tab) {
      haptic("select");
      setVisited((prev) => new Set([...prev, next]));
      setTabVersions((prev) => ({ ...prev, [next]: prev[next] + 1 }));
    }
    localStorage.setItem("active-tab", next);
    pendingScrollTopRef.current = true;
    setTab(next);
  }

  // Programmatic (tab-bar tap) navigation — plays the same slide animation as a
  // swipe by kicking off from dx:0 and letting the CSS transition run.
  function switchTab(next: TabId) {
    if (next === tab) {
      // Re-tapping the already-active tab scrolls it back to top — the native
      // tab-bar gesture, and the only quick way up on a long page.
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (slideRef.current) {
      // A tap on the tab we're already animating toward is a no-op — let the
      // in-flight animation finish instead of snapping it to completion.
      if (slideRef.current.to === next) return;
      commitTab(next);
      return;
    }
    setHighlight(next);
    const dir: 1 | -1 = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
    setVisited((prev) => new Set([...prev, next]));
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

  // Dev-only: constrain the browser preview to iPhone Air width so it reads as a
  // phone instead of a full-width desktop column. `import.meta.env.DEV` is a
  // build-time constant — Vite replaces it with `false` in production and
  // tree-shakes this whole effect out, so the deployed app is never affected.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    document.documentElement.classList.add("dev-phone-frame");
    return () => document.documentElement.classList.remove("dev-phone-frame");
  }, []);

  // The tab bar is `position: fixed; bottom: 0`, which iOS Safari anchors to
  // the layout viewport (full screen height) rather than the visual viewport
  // (which shrinks above the keyboard) — so once the keyboard opens, the bar
  // ends up floating over form content instead of staying pinned under it.
  // Simplest fix: hide it outright while the keyboard is open, since a form
  // input being edited already occupies that space.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      const shrunk = window.innerHeight - vv!.height > 120;
      document.documentElement.classList.toggle("kb-open", shrunk);
    }
    vv.addEventListener("resize", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      document.documentElement.classList.remove("kb-open");
    };
  }, []);

  const contentRef = useRef<HTMLElement | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const axisLocked = useRef<"h" | "v" | null>(null);
  const dragTo = useRef<TabId | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    // Velocity sampling for flick detection (prev trails last by one move so the
    // release speed isn't measured against a near-zero dt). See useHorizontalSwipe.
    let prevX = 0, prevT = 0, lastX = 0, lastT = 0;

    function onTouchStart(e: TouchEvent) {
      // Clear per-gesture state up front, BEFORE the settling guard. A touch
      // that starts during a settle animation is ignored below — but if we left
      // axisLocked at its previous "h" value, the next move after the settle
      // would fire a phantom drag computed against a stale touchStartX (and
      // could even mis-commit a tab).
      axisLocked.current = null;
      dragTo.current = null;
      if (slideRef.current?.settling) return; // ignore during a settle animation
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      prevX = lastX = e.touches[0].clientX;
      prevT = lastT = e.timeStamp;
    }

    function onTouchMove(e: TouchEvent) {
      if (slideRef.current?.settling) return;
      if (e.touches.length !== 1) return; // ignore multi-touch (pinch/zoom)
      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;
      if (axisLocked.current === null) {
        if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 10) {
          axisLocked.current = "h";
          const idx = TAB_ORDER.indexOf(tab);
          const dir: 1 | -1 = dx < 0 ? 1 : -1;
          const to = TAB_ORDER[wrapIndex(idx + dir)];
          dragTo.current = to;
        } else if (Math.abs(dy) > 10) {
          axisLocked.current = "v";
        }
      }
      if (axisLocked.current === "h") {
        e.preventDefault();
        prevX = lastX; prevT = lastT;
        lastX = e.touches[0].clientX; lastT = e.timeStamp;
        const to = dragTo.current;
        if (!to) return;
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        setSlide({ to, dir, dx, settling: false });
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (axisLocked.current !== "h") return;
      const to = dragTo.current;
      const endX = e.changedTouches[0].clientX;
      const dx = endX - touchStartX.current;
      const dt = e.timeStamp - prevT;
      const velocity = dt > 0 ? (endX - prevX) / dt : 0;
      // Commit on enough travel OR a quick flick (matches useHorizontalSwipe).
      const flicked = Math.abs(velocity) >= 0.5 && Math.abs(dx) >= 12;
      if (!to || (Math.abs(dx) < 56 && !flicked)) {
        // Snap back to the current tab.
        if (slideRef.current) {
          setSlide((s) => (s ? { ...s, dx: 0, settling: true } : null));
          scheduleFinalize();
        }
        return;
      }
      setHighlight(to);
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const width = window.innerWidth || 1;
      setSlide({ to, dir, dx: -dir * width, settling: true });
      scheduleFinalize();
    }

    // touchcancel (iOS notification pull, edge gesture, incoming call) fires
    // instead of touchend — without this a mid-drag swipe would strand the panel
    // at its dragged offset until the next touch. Snap it back.
    function onTouchCancel() {
      const wasHorizontal = axisLocked.current === "h";
      axisLocked.current = null;
      dragTo.current = null;
      if (wasHorizontal && slideRef.current) {
        setSlide((s) => (s ? { ...s, dx: 0, settling: true } : null));
        scheduleFinalize();
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [tab]);

  return (
    <ToastProvider>
    <SessionUserProvider user={session.user}>
    <NutritionConfigProvider>
    <SettingsSheetProvider>
      <NavContext.Provider value={switchTab}>
      <PageHeaderContext.Provider value={setHeader}>
        <div className="shell">
          <div className="shell-header">
            <PageTopBar eyebrow={header.eyebrow} title={header.title} onCopy={header.onCopy} note={header.note} />
          </div>
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
                  <IsActiveTabContext.Provider value={tabId === highlight}>
                    <div className="tab-panel" style={style}>
                      <Page />
                    </div>
                  </IsActiveTabContext.Provider>
                </TabActivityContext.Provider>
              );
            })}
          </main>
          <TabBar active={highlight} onChange={switchTab} />
        </div>
        <GlobalSettingsSheet />
        {splash && <Splash variant="overlay" leaving={splashLeaving} />}
      </PageHeaderContext.Provider>
      </NavContext.Provider>
    </SettingsSheetProvider>
    </NutritionConfigProvider>
    </SessionUserProvider>
    </ToastProvider>
  );
}
