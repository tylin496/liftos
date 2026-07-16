---
name: ios-standalone-viewport
description: >-
  Reference for how LiftOS fills the screen as an installed iOS PWA — the
  black-translucent status bar, the --app-height viewport token (dvh browser /
  vh standalone), and safe-area conventions. Load this BEFORE touching any
  full-viewport height (100vh/100dvh/min-height on shell/root/splash/overlays),
  the status-bar area, --safe-top/--safe-bottom, or the apple-mobile-web-app-*
  / viewport meta tags — even a one-liner ("make this overlay full screen",
  "why is there a black strip at the bottom"). Both halves of this setup were
  debugged on-device against known iOS bugs; hand-writing 100dvh on a new
  full-screen surface or "cleaning up" the meta tags re-introduces them.
---

# iOS standalone viewport & status bar

LiftOS runs as an installed PWA (Add to Home Screen, `display: standalone` in
`site.webmanifest`). Two iOS-specific decisions keep it edge-to-edge; both look
redundant until you know the bug they fix.

## 1. Status bar: transparent, app paints nothing

`index.html` has:

```html
<meta name="viewport" content="... viewport-fit=cover ..." />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- `black-translucent` is what lets page content draw under the iOS status bar
  (clock/battery). Without it, iOS paints an opaque bar (black in dark mode)
  above the page and `env(safe-area-inset-top)` is 0.
- **Nothing in-app paints the status-bar band.** There used to be a
  `.status-glass` frosted strip (fixed, `height: var(--safe-top)`); it was
  removed on purpose — content simply scrolls under the clock. Don't
  reintroduce a strip/scrim there without being asked.
- Pages clear the band via `.shell-header` padding:
  `calc(var(--safe-top) + var(--space-5))`. `.top-tap-zone` (same height)
  restores the iOS tap-status-bar-to-scroll-top gesture.
- **Install-time caching gotcha:** iOS bakes the `apple-mobile-web-app-*` meta
  values into the home-screen icon at install. After changing them, the PWA
  must be removed and re-added to the home screen — a relaunch is not enough.
  CSS/JS changes need only a relaunch. Don't spend time debugging "the meta
  isn't working" before re-adding.

## 2. Full-viewport height: always `var(--app-height)`, never a raw unit

Known iOS bug: in standalone under black-translucent, a **cold start reports
`100dvh` (and `window.innerHeight`) excluding the status-bar band** — it only
corrects after an orientation change. A `height: 100dvh` shell therefore falls
short of the screen, leaving a dead black strip at the bottom (~the status-bar
height). `100vh` is correct from launch, and inside standalone there are no
dynamic toolbars so vh and a settled dvh are equal anyway.

In the browser the trade-off inverts: `100vh` overflows behind Safari's
collapsing toolbar, `100dvh` tracks it. So the branch lives in one token
(`tokens.css` §Layout):

```css
--app-height: 100dvh;                      /* browser: tracks Safari toolbar */
@media (display-mode: standalone) {
  :root { --app-height: 100vh; }           /* PWA: dvh lies on cold start */
}
```

Consumers: `.shell` (height), `#root`, `.splash--static`, `.auth-gate`
(min-heights). **Any new full-screen surface — overlay, sheet backdrop, gate,
splash — uses `var(--app-height)`, not `100vh`/`100dvh`/`100svh`.** A raw
`100dvh` on a full-screen surface is the bottom-gap bug coming back; a raw
`100vh` breaks the in-browser preview.

Allowed exceptions: `.dev-phone-frame` (desktop-browser dev chrome, standalone
never applies) and non-critical caps like a sheet's
`max-height: min(620px, calc(100dvh - 32px))`, where a cold-start shortfall
just makes the sheet slightly shorter.

## 3. Safe-area tokens

- `--safe-top` / `--safe-bottom` = `env(safe-area-inset-*, 0px)` (tokens.css).
  Always go through the tokens, not raw `env()`.
- They are 0 in a plain browser tab — anything sized off them must degrade to
  "simply not there" (the old glass strip collapsed to 0 height; header
  padding degrades to `--space-5`).
- Bottom clearance for content above the floating tab bar is
  `--dock-bottom-clearance` = tabbar + safe-bottom + space-6; reuse it, don't
  re-derive the sum.
