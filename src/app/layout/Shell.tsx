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
import { NavContext, NavExpandContext, type NavOptions } from "./NavContext";
import { TabActivityContext } from "./TabActivityContext";
import { PageHeaderContext, IsActiveTabContext, type PageHeader } from "./PageHeaderContext";
import { PageTopBar } from "@shared/components/PageTopBar";
import { ToastProvider } from "@shared/components/Toast";
import { NutritionConfigProvider } from "@features/nutrition/NutritionConfigContext";
import { TrainingMilestone } from "@features/training/TrainingMilestone";
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
  // Pending scroll target (element ID to scroll to within the next tab)
  const [pendingScrollTarget, setPendingScrollTarget] = useState<string | null>(null);
  // The scrollTo id whose detail should auto-expand on this tab entry — set when
  // a nav passes `expand: true`, read via NavExpandContext by the target card.
  const [pendingExpand, setPendingExpand] = useState<string | null>(null);

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
  // The deferred kickoff of a tap-triggered slide (see switchTab). Tracked so a
  // rapid second tap can cancel it before it resurrects a slide we just cleared.
  const kickoffTimer = useRef<number | null>(null);
  // Every tab entry re-fetches and re-renders from a skeleton, so we always
  // land the freshly-loaded page at the top. (Per-tab scroll memory was tried
  // and reverted: the skeleton is 0-height when a restore would fire, so it
  // clamps to 0 anyway — or worse, jumps down once data loads a second later.)
  const pendingScrollTopRef = useRef(false);
  // A nav that asked for a scrollTo target must NOT also get the commit-time
  // auto-scroll-to-top (commitTab fires ~1 slide later than the target scroll,
  // so it would yank the page back to the top right after landing on the card).
  const suppressTopScrollRef = useRef(false);

  useEffect(() => {
    if (!pendingScrollTopRef.current && !pendingScrollTarget) return;
    pendingScrollTopRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pendingScrollTarget) {
          // Scroll to a specific element
          const el = document.getElementById(pendingScrollTarget);
          if (el) {
            const rect = el.getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + rect.top, behavior: "instant" });
          }
          setPendingScrollTarget(null);
          // The target card reads pendingExpand at mount (already captured into
          // its initial state); clear it so a later plain tab re-enter doesn't
          // re-open the section.
          setPendingExpand(null);
        } else {
          // Scroll to top
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      });
    });
  }, [tab, pendingScrollTarget]);

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

  // Bump a tab's activity version — the page is keyed by it (see render), so
  // this REMOUNTS the whole page: its entire entrance replays (card cascade,
  // count-ups, sparklines), and it refetches. Fire it when the tab STARTS coming
  // into view, not when the slide finalizes: otherwise the panel slides in
  // showing its old settled state for the whole slide, then blanks and
  // re-animates once it's already on screen (reads as "rendered → disappears →
  // animates"). Bumping at slide-start means the replay happens as it slides in.
  function enterTab(next: TabId) {
    setVisited((prev) => new Set([...prev, next]));
    setTabVersions((prev) => ({ ...prev, [next]: prev[next] + 1 }));
  }

  function commitTab(next: TabId) {
    setHighlight(next);
    if (next !== tab) {
      haptic("select");
      setVisited((prev) => new Set([...prev, next]));
    }
    localStorage.setItem("active-tab", next);
    // Skip the auto-top-scroll for a deep-link nav — its own target scroll
    // already positioned the page (see suppressTopScrollRef).
    if (suppressTopScrollRef.current) {
      suppressTopScrollRef.current = false;
    } else {
      pendingScrollTopRef.current = true;
    }
    setTab(next);
  }

  // Programmatic (tab-bar tap) navigation — plays the same slide animation as a
  // swipe by kicking off from dx:0 and letting the CSS transition run.
  function switchTab(next: TabId, options?: NavOptions) {
    if (next === tab) {
      // Re-tapping the already-active tab is a no-op — it no longer scrolls to
      // top. A caller asking for a specific target (e.g. Weight → Nutrition's
      // insight card) still jumps there.
      if (options?.scrollTo) {
        const el = document.getElementById(options.scrollTo);
        if (el) {
          const rect = el.getBoundingClientRect();
          window.scrollTo({ top: window.scrollY + rect.top, behavior: "smooth" });
        }
      }
      return;
    }
    if (slideRef.current) {
      // A tap on the tab we're already animating toward is a no-op — let the
      // in-flight animation finish instead of snapping it to completion.
      if (slideRef.current.to === next) return;
      if (options?.scrollTo) {
        setPendingScrollTarget(options.scrollTo);
        suppressTopScrollRef.current = true;
      }
      if (options?.scrollTo && options.expand) setPendingExpand(options.scrollTo);
      // Cancel the in-flight slide's pending finalize and clear the slide state
      // itself. Otherwise the stale timer fires later and commits the OLD slide
      // target (its dx is already off-screen), overriding this tap — and the
      // newly-committed panel renders translated off-screen for the same reason.
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      if (kickoffTimer.current) {
        clearTimeout(kickoffTimer.current);
        kickoffTimer.current = null;
      }
      enterTab(next);
      commitTab(next);
      setSlide(null);
      return;
    }
    if (options?.scrollTo) {
      setPendingScrollTarget(options.scrollTo);
      suppressTopScrollRef.current = true;
    }
    if (options?.scrollTo && options.expand) setPendingExpand(options.scrollTo);
    setHighlight(next);
    const dir: 1 | -1 = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
    enterTab(next);
    // Place the incoming panel off-screen with no transition, then flip to the
    // target on a timer so the browser paints the start frame first. setTimeout
    // (not rAF) so the animation still completes if the tab is backgrounded.
    setSlide({ to: next, dir, dx: 0, settling: false });
    kickoffTimer.current = window.setTimeout(() => {
      kickoffTimer.current = null;
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

  // Pull-to-refresh: a downward drag from the very top of the page (any tab)
  // re-bumps the current tab's activity version, which the render below
  // already keys the page on — same mechanism as a tab re-entry, so it
  // refetches and replays the entrance for free. `dy` is the damped pull
  // distance shown by the indicator; `refreshing` holds it pinned open while
  // the remount plays out.
  const PULL_THRESHOLD = 64;
  const [pull, setPull] = useState<{ dy: number; refreshing: boolean } | null>(null);
  const pullActive = useRef(false);
  // Mirrors `pull?.refreshing` without a stale closure inside the touch
  // handlers below (that effect's deps are [tab], not [pull]).
  const pullRefreshing = useRef(false);

  function refreshTab() {
    haptic("success");
    pullRefreshing.current = true;
    setPull({ dy: PULL_THRESHOLD, refreshing: true });
    setTabVersions((prev) => ({ ...prev, [tab]: prev[tab] + 1 }));
    window.setTimeout(() => {
      pullRefreshing.current = false;
      setPull(null);
    }, 500);
  }

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
      pullActive.current = false;
      if (slideRef.current?.settling || pullRefreshing.current) return; // ignore during a settle/refresh animation
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      prevX = lastX = e.touches[0].clientX;
      prevT = lastT = e.timeStamp;
    }

    function onTouchMove(e: TouchEvent) {
      if (slideRef.current?.settling || pullRefreshing.current) return;
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
          // Only a downward pull that starts at the very top of the page
          // counts — otherwise this is just ordinary vertical scrolling.
          pullActive.current = dy > 0 && window.scrollY <= 0;
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
      } else if (axisLocked.current === "v" && pullActive.current) {
        if (dy <= 0) {
          // Pulled back up past the top — cancel the gesture instead of
          // letting it dip negative (would read as an upward flick).
          pullActive.current = false;
          setPull(null);
          return;
        }
        e.preventDefault();
        // Rubber-band damping so the indicator eases past the threshold
        // rather than tracking the finger 1:1.
        setPull({ dy: Math.min(PULL_THRESHOLD * 1.4, dy * 0.5), refreshing: false });
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (axisLocked.current === "v") {
        if (pullActive.current) {
          pullActive.current = false;
          setPull((p) => {
            if (p && p.dy >= PULL_THRESHOLD) {
              refreshTab();
              return p;
            }
            return null;
          });
        }
        return;
      }
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
      enterTab(to);
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
      if (pullActive.current) {
        pullActive.current = false;
        setPull(null);
      }
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
      <NavExpandContext.Provider value={pendingExpand}>
      <PageHeaderContext.Provider value={setHeader}>
        <div className="shell">
          <div className="shell-header">
            <PageTopBar eyebrow={header.eyebrow} title={header.title} onCopy={header.onCopy} note={header.note} />
          </div>
          <main ref={contentRef} className={`shell-content${slide ? " is-sliding" : ""}`}>
            {pull && (
              <div
                className={`pull-refresh${pull.refreshing ? " is-refreshing" : ""}${pull.dy >= PULL_THRESHOLD ? " is-armed" : ""}`}
                style={{ height: pull.dy }}
              >
                <span className="pull-refresh-spinner" />
              </div>
            )}
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
                      {/* Key the page by its activity version so every tab-enter
                          REMOUNTS it — the whole entrance replays (card cascade,
                          count-ups, sparklines), not just the first visit. */}
                      <Page key={tabVersions[tabId]} />
                    </div>
                  </IsActiveTabContext.Provider>
                </TabActivityContext.Provider>
              );
            })}
          </main>
          <TabBar active={highlight} onChange={switchTab} />
        </div>
        <GlobalSettingsSheet />
        <TrainingMilestone />
        {splash && <Splash variant="overlay" leaving={splashLeaving} />}
      </PageHeaderContext.Provider>
      </NavExpandContext.Provider>
      </NavContext.Provider>
    </SettingsSheetProvider>
    </NutritionConfigProvider>
    </SessionUserProvider>
    </ToastProvider>
  );
}
