import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
import { setActiveScroller } from "./activeScroller";
import { TabActivityContext } from "./TabActivityContext";
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
  // Drives each page's `key` — bumping it REMOUNTS the page (full entrance
  // replay + skeleton + land-at-top). Only bumped on a "fresh" entry: first
  // visit, a deep-link, or a return after the tab sat idle past REPLAY_IDLE_MS.
  // A quick back-and-forth keeps the same key, so the page stays mounted and
  // its scroll position is preserved (see scrollMemory).
  const [tabVersions, setTabVersions] = useState<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  // Drives each page's TabActivityContext — bumped on EVERY entry (fresh or
  // resume) so pages refetch in the background without remounting. Split from
  // tabVersions so a resume refetches-in-place instead of flashing a skeleton.
  const [tabActivity, setTabActivity] = useState<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  // Each tab panel's scroll container element (the .tab-panel div is stable per
  // tab — only its Page child remounts on a replay — so its scrollTop persists
  // natively across display:none). Used to drive/read per-tab scroll directly.
  const panelRefs = useRef<Record<TabId, HTMLDivElement | null>>(
    { overview: null, training: null, nutrition: null, health: null },
  );
  // Each tab's scrollTop, captured when we start leaving it — restored onto the
  // panel the moment it becomes visible again (belt-and-suspenders over native
  // retention; also the source for landing after a replay resets it).
  const scrollMemory = useRef<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  // Wall-clock ms when we last left each tab. `now − leftAt[next]` is how long
  // the target sat idle, which decides resume (keep position) vs fresh (replay).
  const leftAt = useRef<Record<TabId, number>>(
    { overview: 0, training: 0, nutrition: 0, health: 0 },
  );
  // The SINGLE landing intent for the next tab commit, computed once in
  // enterTab and consumed once by the layout effect below. Collapses what used
  // to be four racing flags (top / restore / suppress-top / scrollTo-target)
  // into one decision, so exactly one scroll strategy runs per entry.
  //   top     — fresh entry: land at the top
  //   restore — resume: restore the remembered offset (synchronous, no flash)
  //   element — deep-link: hand off to the async alignment observer
  const landingRef = useRef<
    | { kind: "top" }
    | { kind: "restore"; y: number }
    | { kind: "element"; id: string }
    | null
  >(null);
  // False while a landing is pending — the layout effect applies it to the
  // panel the moment that panel is on screen (slide-start or direct commit),
  // then flips this true so it isn't re-applied and doesn't fight user scroll.
  const landingAppliedRef = useRef(true);
  // How long a tab must sit unvisited before a return replays its entrance and
  // lands at the top instead of resuming where you left off. Under this, a
  // back-and-forth is treated as "still reading" and keeps its place.
  const REPLAY_IDLE_MS = 3 * 60_000;
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
  // Handle for an in-flight deep-link alignment (see startAlign). Kept in a ref,
  // not tied to an effect's cleanup, so a superseding nav cancels the prior
  // observer explicitly rather than a state change tearing it down mid-flight.
  const alignRef = useRef<{ cancel: () => void } | null>(null);

  // Position a tab's own scroll container the moment it's on screen. Because
  // each panel scrolls independently, there's nothing to restore for a plain
  // resume — the panel kept its scrollTop natively. This runs only to apply a
  // deliberate landing: reset to top on a fresh entry (the panel element is
  // reused across a Page remount, so its old scrollTop would otherwise linger),
  // restore a captured offset defensively, or hand a deep-link to the observer.
  // Applied at slide-start (panel already absolute/visible) so it's in place
  // before it slides in — never a commit-time jump. Registers the active
  // scroller for the imperative scrollers in feature code (see activeScroller).
  useLayoutEffect(() => {
    if (landingAppliedRef.current) return;
    const landing = landingRef.current;
    if (!landing) { landingAppliedRef.current = true; return; }
    // The panel that will show this landing: mid-slide it's the incoming one
    // (already rendered visible), otherwise the freshly-active tab.
    const targetTab = slide ? slide.to : tab;
    const el = panelRefs.current[targetTab];
    if (!el) return; // not mounted yet — a later render will catch it
    if (landing.kind === "element") {
      // Apply at slide-start too (the incoming panel is already absolute). For a
      // warm target the content is loaded, so startAlign's instant pre-scroll
      // lands the card while the panel is still off-screen — it slides in already
      // on the card, no top-then-scroll. For a cold/replay target the panel is a
      // skeleton, so the instant pass is a no-op and the observer glides to the
      // card once data arrives.
      landingAppliedRef.current = true;
      landingRef.current = null;
      alignRef.current?.cancel();
      el.scrollTop = 0;
      startAlign(landing.id, el);
      return;
    }
    landingAppliedRef.current = true;
    landingRef.current = null;
    alignRef.current?.cancel();
    el.scrollTop = landing.kind === "restore" ? landing.y : 0;
  }, [slide, tab]);

  // Keep the imperative-scroller registry pointed at the active panel.
  useEffect(() => {
    setActiveScroller(panelRefs.current[tab]);
  }, [tab]);

  // Clear the expand signal once the target card has consumed it. This is a
  // PASSIVE effect, and React flushes descendants' passive effects before an
  // ancestor's — so the target card (deep inside a panel) has already read
  // pendingExpand and opened its section before we reset it here. Resetting lets
  // a later PLAIN entry to that tab see null and NOT auto-open.
  useEffect(() => {
    if (pendingExpand == null) return;
    setPendingExpand(null);
  }, [pendingExpand]);

  // Deep-link alignment within the target panel. The Page has just remounted to
  // a skeleton; the target card sits at short-page height now and shifts once
  // data lands. So DON'T scroll yet — wait for the first real height change
  // (skeleton → data) and let that single scroll carry us to the target, then
  // RE-ALIGN on every later shift. Stops only when the user takes over
  // (scroll/tap/key) or a superseding nav fires — never on a timer, so it stays
  // correct through any future card content/layout (slow load, lazy image, font
  // swap). No feedback loop: scrolling doesn't resize elements, so scrollIntoView
  // never re-fires the observer. scrollIntoView honours the card's
  // scroll-margin-top (a breath) and auto-scrolls this panel (nearest scroller).
  function startAlign(targetId: string, scroller: HTMLElement) {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let lastHeight = 0;
    const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Two modes:
    //  • instant — the first pass, run while the panel is still sliding in. For a
    //    warm (already-loaded) target this lands the card off-screen so it slides
    //    in already in place; on a cold skeleton it's a harmless no-op.
    //  • smooth  — every later pass, once data has grown the page. The tab has
    //    settled at the top, so a smooth scroll GLIDES down to the card rather
    //    than snapping. (Reduced-motion forces instant.)
    const align = (smooth: boolean) =>
      document.getElementById(targetId)?.scrollIntoView({
        block: "start",
        behavior: smooth && !reduced ? "smooth" : "auto",
      });
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      ro?.disconnect();
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel);
      if (alignRef.current?.cancel === cancel) alignRef.current = null;
    };
    alignRef.current = { cancel };
    // Watch the panel's CONTENT box, not the panel itself: the panel is a
    // fixed-height scroll container (height:100%), so its own border box never
    // changes when the page grows inside it — a ResizeObserver on the scroller
    // would never fire. The content wrapper (.page) is what grows skeleton→data.
    const content = scroller.firstElementChild ?? scroller;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        lastHeight = content.scrollHeight;
        align(false); // instant pre-position (warm: lands off-screen; cold: no-op)
        window.addEventListener("wheel", cancel, { passive: true });
        window.addEventListener("touchstart", cancel, { passive: true });
        window.addEventListener("pointerdown", cancel, { passive: true });
        window.addEventListener("keydown", cancel);
        ro = new ResizeObserver(() => {
          if (cancelled) return;
          const h = content.scrollHeight;
          if (h === lastHeight) return; // ignore the initial no-op fire
          lastHeight = h;
          align(true); // glide to the card as the data grows the page in
        });
        ro.observe(content);
      });
    });
  }

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

  // Record the leaving tab's scroll position + leave time. The panel keeps its
  // scrollTop natively, but we snapshot it too so a landing after a replay (or a
  // browser that drops scrollTop on display:none) can restore it deterministically.
  function noteLeaving() {
    scrollMemory.current[tab] = panelRefs.current[tab]?.scrollTop ?? 0;
    leftAt.current[tab] = Date.now();
  }

  // Begin entering `next`. Always bumps activity (background refetch), then
  // decides this entry's single landing intent (applied to the panel by the
  // layout effect the moment it's on screen). A stale/first entry replays
  // (remount + land at top); a quick back-and-forth — including a deep-link to a
  // tab you were just on — resumes (keep the mounted panel + its loaded content),
  // which lets a deep-link pre-position on the card DURING the slide instead of
  // landing at top and scrolling after a skeleton reload. Runs at slide-start so
  // a replay animates as the panel slides in.
  function enterTab(next: TabId, targetId?: string) {
    const firstVisit = !visited.has(next);
    const idle = Date.now() - leftAt.current[next];
    const replay = firstVisit || idle >= REPLAY_IDLE_MS;

    setVisited((prev) => new Set([...prev, next]));
    setTabActivity((prev) => ({ ...prev, [next]: prev[next] + 1 }));
    if (replay) setTabVersions((prev) => ({ ...prev, [next]: prev[next] + 1 }));

    landingRef.current = targetId
      ? { kind: "element", id: targetId }
      : replay
        ? { kind: "top" }
        : { kind: "restore", y: scrollMemory.current[next] ?? 0 };
    landingAppliedRef.current = false;
  }

  function commitTab(next: TabId) {
    setHighlight(next);
    if (next !== tab) {
      haptic("select");
      setVisited((prev) => new Set([...prev, next]));
    }
    localStorage.setItem("active-tab", next);
    setTab(next); // the layout effect above positions the viewport
  }

  // Programmatic (tab-bar tap) navigation — plays the same slide animation as a
  // swipe by kicking off from dx:0 and letting the CSS transition run.
  function switchTab(next: TabId, options?: NavOptions) {
    if (next === tab) {
      // Re-tapping the already-active tab is a no-op — it no longer scrolls to
      // top. A caller asking for a specific target (e.g. Weight → Nutrition's
      // insight card) still jumps there.
      if (options?.scrollTo) {
        // Auto-scrolls the active panel (its nearest scrollable ancestor).
        document.getElementById(options.scrollTo)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      return;
    }
    if (slideRef.current) {
      // A tap on the tab we're already animating toward is a no-op — let the
      // in-flight animation finish instead of snapping it to completion.
      if (slideRef.current.to === next) return;
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
      // The outgoing tab's scroll was already captured when the in-flight slide
      // began, so don't re-note here (the slide has zeroed scrollY).
      enterTab(next, options?.scrollTo);
      commitTab(next);
      setSlide(null);
      return;
    }
    if (options?.scrollTo && options.expand) setPendingExpand(options.scrollTo);
    setHighlight(next);
    const dir: 1 | -1 = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
    noteLeaving();
    enterTab(next, options?.scrollTo);
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
  // Mirrors the live `pull.dy` outside React state so onTouchEnd can read the
  // armed distance directly. Reading `pull` via a setPull functional updater
  // and calling refreshTab() (which itself calls setPull/setTabVersions) from
  // inside that "pure" updater is what caused the runaway update loop — a
  // second pull landed while the first's cascade was still resolving.
  const pullDy = useRef(0);

  function refreshTab() {
    haptic("success");
    pullRefreshing.current = true;
    pullDy.current = 0;
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
          // Capture the outgoing scroll now, before the slide collapses the
          // document and zeroes scrollY (so a resume can restore it).
          noteLeaving();
          const idx = TAB_ORDER.indexOf(tab);
          const dir: 1 | -1 = dx < 0 ? 1 : -1;
          const to = TAB_ORDER[wrapIndex(idx + dir)];
          dragTo.current = to;
        } else if (Math.abs(dy) > 10) {
          axisLocked.current = "v";
          // Only a downward pull that starts at the very top of the page
          // counts — otherwise this is just ordinary vertical scrolling.
          pullActive.current = dy > 0 && (panelRefs.current[tab]?.scrollTop ?? 0) <= 0;
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
          pullDy.current = 0;
          setPull(null);
          return;
        }
        e.preventDefault();
        // Rubber-band damping so the indicator eases past the threshold
        // rather than tracking the finger 1:1.
        const damped = Math.min(PULL_THRESHOLD * 1.4, dy * 0.5);
        pullDy.current = damped;
        setPull({ dy: damped, refreshing: false });
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (axisLocked.current === "v") {
        if (pullActive.current) {
          pullActive.current = false;
          // Read the armed distance from the ref, then call refreshTab (a side
          // effect that itself calls setPull/setTabVersions) as a plain
          // statement here — NOT from inside a setPull functional updater,
          // which is what let a fast second pull compound into a runaway
          // update loop (React error #185).
          if (pullDy.current >= PULL_THRESHOLD) {
            refreshTab();
          } else {
            setPull(null);
          }
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
        <div className="shell">
          <main ref={contentRef} className={`shell-content${slide ? " is-sliding" : ""}`}>
            {pull && (
              <div
                className={`pull-refresh${pull.refreshing ? " is-refreshing" : ""}${pull.dy >= PULL_THRESHOLD ? " is-armed" : ""}`}
                style={{ height: pull.dy }}
              >
                <span className="pull-refresh-spinner" />
              </div>
            )}
            {/* Each panel is its own overflow-y:auto scroller (layout.css), so a
                tab keeps its scroll position natively while another is on screen —
                no shared window scroll to collapse and restore. */}
            <div className="tab-viewport">
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
                  <TabActivityContext.Provider key={tabId} value={tabActivity[tabId]}>
                    <div
                      className="tab-panel"
                      style={style}
                      ref={(el) => { panelRefs.current[tabId] = el; }}
                    >
                      {/* Key the page by its activity version so every FRESH
                          tab-enter REMOUNTS it — the entrance replays and the
                          scroller resets to top. A resume keeps the key, so the
                          panel stays mounted at its scroll position. */}
                      <Page key={tabVersions[tabId]} />
                    </div>
                  </TabActivityContext.Provider>
                );
              })}
            </div>
          </main>
          <TabBar active={highlight} onChange={switchTab} />
        </div>
        <GlobalSettingsSheet />
        <TrainingMilestone />
        {splash && <Splash variant="overlay" leaving={splashLeaving} />}
      </NavExpandContext.Provider>
      </NavContext.Provider>
    </SettingsSheetProvider>
    </NutritionConfigProvider>
    </SessionUserProvider>
    </ToastProvider>
  );
}
