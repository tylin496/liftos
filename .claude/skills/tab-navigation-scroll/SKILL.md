---
name: tab-navigation-scroll
description: Reference for LiftOS's tab-switching and scroll-positioning architecture in Shell.tsx — per-tab scroll containers, the single landing-intent model, deep-link alignment, fresh-vs-resume entry, and the shared swipe-gesture pattern. Load this BEFORE touching Shell.tsx, adding a new tab, adding a deep-link (a card another tab can jump to), adding any scroll-to-element behavior, or adding a swipe/drag gesture anywhere in the app — even if the task looks small ("just scroll to this card", "add a tap-to-jump row", "make this swipeable"). This architecture replaced several buggy earlier attempts, and re-deriving any of those attempts from scratch is a real regression risk, not a hypothetical one.
---

# LiftOS tab navigation & scroll

This app went through several rounds of "why does the screen jump when I switch tabs" before landing on the architecture below. Every decision here exists because a simpler version of it visibly broke. Treat this as the reason NOT to hand-roll a new scroll/nav mechanism — reuse what's here, or extend it deliberately.

Core files: `src/app/layout/Shell.tsx` (owns all of this), `src/app/layout/layout.css`, `src/app/layout/activeScroller.ts`, `src/app/layout/NavContext.tsx`, `src/app/layout/TabActivityContext.tsx`, `src/shared/hooks/useHorizontalSwipe.ts`.

## 1. The window never scrolls — each tab is its own scroller

`.shell` is fixed-height + `overflow:hidden`. Each `.tab-panel` is its own `overflow-y:auto` scroll container (`.shell` → `.shell-content` flex col → `.tab-viewport` clips/positions the panels → `.tab-panel` scrolls).

**Why:** the old design scrolled the shared `window`. During a tab-swipe, panels go `position:absolute` and the document collapses to one viewport, forcing `scrollY` to 0 — so the incoming tab was pinned to its own top for the *entire slide*, then snapped to wherever it should've been the instant the slide committed. That snap was a visible, un-fixable flash: there was no way to "restore scroll" fast enough, because the wrong position had already been painted for hundreds of milliseconds.

Giving each tab its own scroller kills the bug at the root: a tab's `scrollTop` persists natively while another tab is on screen. Nothing to save, nothing to restore, nothing to flash.

**What this means for new code:** `window.scrollTo` / `window.scrollY` / `document.body.scrollTop` are all dead for in-app scrolling — there is no longer a meaningful "the window's scroll position." If you need to scroll the *current* tab imperatively (not via `scrollIntoView`, which already finds the right panel on its own), pull the active panel from `src/app/layout/activeScroller.ts`:

```ts
import { getActiveScroller } from "@app/layout/activeScroller";
getActiveScroller()?.scrollTo({ top: 0, behavior: "smooth" });
```

Don't add a new `window.scroll*` call anywhere in a feature page — it will silently do nothing (or scroll a document that isn't the one on screen).

**`.tab-panel`'s scrollbar is deliberately hidden** (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`), not reserved-via-`scrollbar-gutter` — matching the existing convention in nutrition's `.ncal-grid`. This isn't cosmetic: every page here loads its data as one atomic swap (never progressively — see `reloadAll` in `training/page.tsx`), so a tab's content grows from skeleton to full height in a single commit. A mouse-driven browser's classic, space-taking scrollbar popping in right as that happens (and the card column narrowing to make room for it) reads as a visible squeeze-then-settle judder — a real shipped bug (2026-07-08). `scrollbar-gutter: stable` "fixes" the width-jump in principle but still shows the track+thumb on any mouse/trackpad browser; hiding it outright removes the concern entirely, on every browser, since real touch devices already use an auto-hiding overlay scrollbar that never took width in the first place. Touch/wheel/programmatic scrolling all still work with the scrollbar hidden — don't reintroduce a visible scrollbar or swap back to `scrollbar-gutter: stable` on `.tab-panel` to "fix" a width jump; the fix is hiding it, not reserving for it.

## 2. One landing intent, decided once, applied once

Every tab commit computes exactly one `landingRef` in `enterTab` (Shell.tsx), and exactly one `useLayoutEffect` applies it:

```ts
{ kind: "top" }               // fresh entry — land at the top
{ kind: "restore", y: number } // resume — restore the remembered scrollTop
{ kind: "element", id: string } // deep-link — hand off to startAlign (§4)
```

**Why it's a single ref instead of several flags:** earlier versions of this had ~5 independent booleans/refs (a "scroll to top" flag, a "suppress top scroll" flag, a pending scroll-target state, etc.) that could each fire on the same commit. When two of them disagreed about what should happen, the page visibly jumped mid-animation. Collapsing them into one tagged value makes "what happens on this commit" a single decision instead of a race.

**Why the effect is `useLayoutEffect`, not `useEffect`:** `useLayoutEffect` runs synchronously before the browser paints. A `top`/`restore` landing applied here is *already in position* in the first painted frame — no one-frame flash of the wrong scroll position. If you're tempted to move a scroll-positioning effect to plain `useEffect` (or wrap it in `requestAnimationFrame`) "because it's cleaner," don't — that reintroduces the exact flash this was built to kill. (Deep-link's `element` kind is the one exception that's inherently asynchronous — see §4 for why.)

**If you're adding a new kind of landing:** don't add a new ref/flag next to `landingRef`. Add a new tagged variant to the union and a branch in the layout effect. The whole point is that there's one place that decides where the tab lands.

**Every `el.scrollTop = ...` write in this effect is guarded to skip a no-op** (`if (el.scrollTop !== target) el.scrollTop = target`). This isn't defensive paranoia — a plain resume's target usually already matches (the panel kept its scrollTop natively; the write is only a defensive belt-and-suspenders for a browser that drops it on `display:none`), and assigning the SAME value scrollTop already holds still counts as "a scroll happened" on some engines, notably iOS Safari — which briefly flashes its native overlay scroll indicator even though nothing actually moved (a real shipped bug: switching back to a tab flashed a scrollbar for about a second, 2026-07-08). If you add a new `el.scrollTop = ...` write anywhere in Shell, guard it the same way.

## 3. Fresh entry vs. resume — two counters, not one

`tabVersions[tab]` and `tabActivity[tab]` are separate counters bumped by `enterTab`:

- **`tabVersions`** is the page's React `key`. Bumping it **remounts** the page — full skeleton, full entrance-cascade replay, scroll resets to top. It's bumped only on a "fresh" entry: first visit ever, a deep-link (see §4 — a deep-link always wants replay semantics so the target can re-read its expand signal at mount), or a return after the tab sat idle ≥ `REPLAY_IDLE_MS` (currently 3 minutes).
- **`tabActivity`** feeds `TabActivityContext` and is bumped on **every** entry, fresh or not, so pages can background-refetch without remounting.

**Why split them:** a quick tab-switch-and-back (checking another tab for a second, then returning) should feel instantaneous — same scroll position, same rendered content, maybe a quiet background refresh. If a single counter drove both remount and refetch, every tab switch would flash a skeleton and replay the entrance animation, which reads as broken/laggy for something that should feel free. Splitting them means "did enough time pass that this should feel like a fresh visit" and "should this page refresh its data" are independent questions, because they are.

**If you're adding a new page-level entrance animation:** key it the same way — either off `tabVersions` (replays only on fresh entry) or literally off the `.tr-enter`/`didSwitchRef`-style pattern already used by Training's exercise-card cascade, not off something that changes on every render.

## 4. Deep-link alignment (jumping to a specific card in another tab)

A deep-link (e.g. an Overview card that navigates to a specific card in Training or Health) is the `{ kind: "element", id }` landing, handled by `startAlign(targetId, scroller)` in Shell.tsx.

**The ResizeObserver watches the wrong thing at your peril.** `startAlign` observes `scroller.firstElementChild` (the page's own content wrapper), **not the panel itself**. This is not stylistic — a real bug shipped from getting this backwards: the panel is a fixed-height (`height:100%`) scroll container, so its own border box *never changes size* when the page inside it grows from skeleton to real content. A `ResizeObserver` on the panel silently never fires, and the deep-link never scrolls anywhere. The content wrapper is what actually grows, so that's what must be observed.

**Every pass is instant — this was NOT the original design, and reverting it back to smooth is a real regression.** `align()` runs once while the panel may still be sliding in off-screen (a warm target lands before it's even visible — zero perceived motion on a cold skeleton it's a no-op), and again on every later ResizeObserver fire as the skeleton grows into real content.

An earlier version made that *later* catch-up pass smooth (`scrollIntoView({ behavior: "smooth" })`), reasoning that a first-time/stale visit should *glide* to the target as data streams in rather than snap repeatedly. That reasoning doesn't hold in this app: every page loads its data as ONE atomic swap (a single `Promise.all` — see `reloadAll` in `training/page.tsx` and its Health/Overview equivalents), never a progressive/staged reveal, and that same swap is what triggers the page's entrance cascade (cards rising in). A smooth scroll-catch-up therefore always runs *concurrently* with the entrance cascade — the viewport gliding downward while cards are still popping in above it reads as competing motion, not a graceful glide. That was a real, shipped judder (jumping from Overview's Training Health card to its full card at the bottom of Training's exercise list). Instant lands the target in the same frame the layout settles, so the cascade is the only motion on screen.

**If you're ever tempted to make a catch-up align smooth again** (it'll look like the "obviously nicer" choice in isolation): first check whether the page whose height is shifting loads progressively or as one swap. If it's one swap — which is every page in this app today — smooth will fight that page's entrance cascade. Reduced-motion is moot here since everything's already instant.

**It stops on user intent, never on a timer.** `cancel()` fires on the user's first `wheel`/`touchstart`/`pointerdown`/`keydown`, or when a new nav supersedes it. There's deliberately no `setTimeout` cutoff — if there were, a slow network fetch could finish loading the target card *after* the observer gave up, silently breaking the deep-link. Don't add a timeout here to "clean things up"; the event-based cancellation already covers every real cleanup case (user takes over, or a new nav starts).

**If you're adding a new deep-link target:** you don't need to touch `startAlign` at all — just call `nav(tabId, { scrollTo: "your-element-id" })` (see `NavContext.tsx`) from the source card, and give the target element that `id`. The generic alignment machinery handles the rest, cold or warm.

## 5. Expand-on-arrival must be reactive, not just initial state

If a deep-link should also *open* something on the target card (e.g. "jump to Training and expand the On Track section"), don't gate that behind `useState(isNavTarget)` alone — a warm/already-mounted card never re-reads its initial state, so the expand silently does nothing on a repeat visit. Instead, react to the signal with an effect, the way `StrengthHealthCard` does:

```ts
const isNavTarget = variant === "full" && id != null && useNavExpand() === id;
useEffect(() => { if (isNavTarget) setTrackOpen(true); }, [isNavTarget]);
```

Shell clears the underlying `pendingExpand` signal in its own **passive** effect (not inside `startAlign`/a layout effect), specifically so that descendant effects — like the one above — flush and consume the signal first. If you move that clear into a layout effect "to be tidier," you'll race the card's own effect and the expand will stop firing.

## 6. Re-tapping the tab you're already on

`switchTab`'s `next === tab` branch scrolls that tab's panel back to top (`panelRefs.current[tab]?.scrollTo({ top: 0, behavior: "smooth" })`) — the standard "tap home to go home" gesture. A caller that passed a specific `scrollTo` target gets that instead of the top. If you're adding a new way to re-enter the current tab, route it through `switchTab`/`nav()` rather than writing a parallel scroll-to-top somewhere else — this branch is the one place that decision lives.

## 7. Swipe gestures: reuse `useHorizontalSwipe`, don't hand-roll touch handlers

Shell owns the cross-tab swipe (finger-follow drag between whole tabs) via its own touch listeners on the shared content container — plus a parallel **mouse** path (desktop parity, so the gesture is testable with a cursor) that mirrors only the *horizontal* half; the pull-to-refresh half stays touch-only because a downward mouse drag is ordinary text selection. Any **feature-level** horizontal gesture that needs to happen *inside* a tab without triggering that cross-tab swipe — Training's Push/Pull/Legs split-pager, Nutrition's day and week navigation — should use `src/shared/hooks/useHorizontalSwipe.ts`, not a new set of touch handlers.

**How the desktop mouse tab-swipe defers to feature swipers:** touch uses `stopPropagation` on axis-lock (the feature listener sits below Shell's in the same bubble path). Mouse can't — both put move/up on `window`, so there's no bubble relationship — so `useHorizontalSwipe` sets a module-level `featureHSwipeActive` flag on horizontal lock (read via `isFeatureHSwipeActive()`), and Shell's mouse path bails the instant it sees that flag. The feature listener always registers first (its inner-element `mousedown` fires before Shell's ancestor one), so it locks and sets the flag before Shell's `window` move handler runs. Don't delete that flag thinking `stopPropagation` covers it — that only covers touch. Note the same duality all these gestures share on desktop: chart-scrub (`useChartScrub`, pointer events) and the in-tab swipers (`useHorizontalSwipe`, mouse events) both fire alongside Shell's mouse listeners just as they do on touch, so any coexistence that works on touch works on mouse for the same reason — and any latent touch conflict is now reproducible with a cursor too.

**Why this specific hook stops Shell from also reacting:** DOM events bubble from the deepest target outward. The hook's listener sits on a descendant of Shell's own listener, and calls `e.stopPropagation()` on `touchmove`/`touchend` the moment its axis locks horizontal — which happens *before* the event would otherwise reach Shell's ancestor listener in the same bubble phase. Hand-rolling your own `touchstart`/`touchmove` pair without this stop-propagation step will fight Shell's tab-swipe (both trying to interpret the same drag), even if your logic looks correct in isolation.

**The established edge pattern**, used by all three current consumers: live 1:1 drag within bounds via `onDrag`, a damped rubber-band once you're at a true edge (`Math.sign(dx) * Math.min(72, Math.abs(dx) * 0.2)`), and a real commit only past a distance threshold or a fast flick (the hook already implements this threshold/flick logic — `onSwipe` only fires when it's warranted). Training's split-swipe extends this one step further: swiping past the *last* split's edge hands off to the next app tab via `useNav()` instead of just rubber-banding forever — i.e., an edge doesn't have to mean "stop," it can mean "hand off to the next level of navigation," if that's the right UX for your case.

**If you're adding a new swipeable region:** reach for `useHorizontalSwipe` first. Only write custom touch handling if the gesture genuinely isn't "drag horizontally, commit past a threshold" (e.g. a 2D drag, a long-press, a pinch) — and even then, check whether it also needs to stop Shell's swipe from double-firing, using the same `stopPropagation`-on-lock approach.

## 8. Jump-to-card-and-center, and the remount-judder trap

Training Health's "jump to this exercise's card" (tap a row → scroll to and open that exercise) lands the target **centered** (`scrollIntoView({ block: "center" })`), not top-aligned — top-aligned reads as "shoved to the edge" for a short card with empty space below it; centered reads as "here's the thing you asked for."

It's positioned via `useLayoutEffect`, not `useEffect` + `requestAnimationFrame`. **Why this matters here specifically:** if the jump also switches split/section (the list remounts under a new `key`), a post-paint (`useEffect`/rAF) scroll paints one frame of the *new* content at the panel's *stale* scroll position first, then jumps — a visible judder, on top of everything in §1 this architecture already fixed once. `useLayoutEffect` positions the panel in the same frame the remount commits, so there's no stale frame to see.

**If you're adding a similar "tap a summary row → jump to and focus a detail card" pattern anywhere else:** copy this shape (one-shot nonce signal so re-tapping the same row re-fires, `useLayoutEffect` for the scroll, `center` unless you have a specific reason to top-align) rather than reinventing scroll timing from scratch.
