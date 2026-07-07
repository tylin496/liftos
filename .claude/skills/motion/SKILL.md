---
name: motion
description: Reference for LiftOS's role-driven motion system — the animation durations, easing curves, and the CSS/JS animation patterns the app standardised on (all defined in src/shared/styles/tokens.css §Motion). Load this BEFORE adding or editing ANY @keyframes, animation, transition, count-up, entrance/exit, or motion timing anywhere in the app — even a one-line tweak ("just make this fade in", "add a little bounce", "why does this pop before the bar"). The app was audited off an inconsistent --motion-fast/base/slow scheme and rewritten onto these role tokens; hand-writing a raw ms value, inventing a fourth curve, or re-deriving an entrance/count-up pattern from scratch is the exact regression this exists to prevent.
---

# LiftOS motion system

This app's animations were "principled at the token layer but a mess at the usage layer" — the same entrance played at 220 / 340 / 400ms in different files, slides sprang in Nutrition but not Training, and pop peaks were 1.06 / 1.14 / 1.35 at random. That was audited and rewritten into the role system below. **The whole point is that you can no longer choose a duration or a curve — you choose a ROLE, and two things with the same role animate identically.** Adding a raw ms, a fourth ease, or a per-element magic number is the bug this prevents.

Core files: `src/shared/styles/tokens.css` (§Motion — the tokens), `src/shared/styles/global.css` (shared keyframes + the reduced-motion guard), `src/shared/hooks/useCountUp.ts` (the one count-up), `src/shared/components/ActivityRing.tsx` (ring/overflow geometry).

## 1. Pick a role, never a number

Every `animation`/`transition` in the app resolves to one of these tokens. If you're typing a raw `ms` or a fresh `cubic-bezier`, stop — use a role.

**Durations** (one per role):

| token | value | role |
|-------|-------|------|
| `--dur-press` | 120ms | tap · hover · colour/opacity feedback |
| `--dur-exit` | 200ms | anything leaving (fade / slide out) |
| `--dur-move` | 280ms | positional travel: slide · sheet · nav · sheen |
| `--dur-enter` | 400ms | anything appearing: card · form · row · bar · toast |
| `--dur-pop` | 440ms | attention / celebration pulse |
| `--dur-celebrate` | 900ms | confetti · gold ring |
| `--dur-sheen` | 1000ms | PR sheen · row-saved flash sweep |
| `--dur-shimmer` | 1600ms | skeleton loading loop |
| `--dur-ambient` | 3000ms | splash breathe / float loops |

**Curves** (one per role — `--ease-pop` is the ONLY bounce; nothing else overshoots):

| token | value | role |
|-------|-------|------|
| `--ease-press` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | feedback |
| `--ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)` | reveals — slight settle |
| `--ease-move` | `cubic-bezier(0.4, 0, 0.2, 1)` | positional |
| `--ease-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | pops only |

**Shared constants:** `--enter-wait: 100ms`, `--stagger-step: 50ms`, `--enter-rise: 12px`, `--slide-near: 40%`, `--pop-peak: 1.08`, `--tap-scale: 0.97`.

**Canonical pairings** (duration + its curve): entrance = `--dur-enter` + `--ease-enter`; exit = `--dur-exit`; slide/sheet/nav = `--dur-move` + `--ease-move`; attention/celebration pulse = `--dur-pop` + `--ease-pop`; sheen = `--dur-sheen`; shimmer = `--dur-shimmer`; confetti/gold-ring = `--dur-celebrate`. The old `--motion-fast/base/slow` and `--press/reveal/move/spring-ease` and `--enter-dur` tokens were deleted — do not reintroduce them.

## 2. Entrance is FLAT — with a few sanctioned internal cascades

Page-level reveals all start together on the `--enter-wait` beat, then run for `--dur-enter` (→ 500ms total). There is no bottom-up page wave. The ONLY places allowed an internal, within-element `--stagger-step` cascade are: the Health sparkline draw, the Nutrition 7-day week bars, the Training-Health segmented bar (`.ov-th-bar` green cells), and the Nutrition trend-bar value gate. Don't add a new staggered page wave; don't flatten those four.

## 3. CSS entrance animations must play ONCE on mount and never re-trigger on a state change

An entrance keyframe fires when the element mounts. It replays only on remount (a `key` change) — never on a plain re-render. Two traps and their fixes:

- **Don't scope an entrance animation to a class that toggles on interaction** (e.g. `.is-selected`). When selection moves, the selector newly matches the new element and the animation re-fires with its stagger delay — so tapping lags. Seen and fixed in the Nutrition trend bar.
- **The gate + span pattern** (Nutrition `.ntb-values`): when a value must (a) fade in ON the same delayed clock as its bar during entrance, but (b) show/hide instantly when you tap a different day — split the two. The container (`.ntb-values`) is an entrance *gate*: `opacity 0→1`, `animation-delay` matching its bar's delay (via an inherited `--bar-index` set on the column, not the bar), plays once on mount. Selection lives on the inner spans (`.ntb-val-kcal/.ntb-val-prot`) as a plain `opacity` transition — instant, no re-play. A shared `nutri-val-in` keyframe does the gate.

## 4. "One at a time" is a SNAP + stagger, not a gradual grow

A discrete "cell-by-cell fill" (the Training-Health bar) must read as ticks, not a stepless sweep. Each cell **snaps to full instantly** — `opacity 0→1` over `1ms` (`th-seg-in`) — and the one-by-one rhythm comes purely from a fixed `--stagger-step` per cell (`.ov-th-bar-seg.is-good::before { animation-delay: inherit }`, delay set inline as `calc(var(--enter-wait) + i * var(--stagger-step))`). A `scaleX(0→1)` grow reads as "無級"/stepless and was rejected. Also: the grey track (`.ov-th-bar-seg`) is a full static background; the green is a `::before` overlay on top, so the bar is never blank before the green lands.

## 5. Count-ups: one hook, quad ease, isolated, self-stopping

`useCountUp` is the single number-roll for the whole app. Rules baked in — don't diverge:

- **Ease is ease-out quad** (`1 - Math.pow(1 - t, 2)`), **duration `COUNT_UP_MS = 550`**. This was changed from quart@400 because quart front-loaded so hard the "0" showed for one frame and the low digits were invisible — quad@550 makes it read as counting. If you ever pair a CSS transition with a count-up (e.g. a bar filling alongside the number), its bezier MUST mirror easeOutQuad: `cubic-bezier(0.5, 1, 0.89, 1)` (see `GoalBarFill` in overview/page.tsx).
- **Keep it in a leaf component** so the per-frame re-render is scoped to just the number/ring, not the whole card (see `ActiveTargetRingRoll`, `RetentionPctRoll`).
- rAF stops itself at `t >= 1` (no infinite loop). It's gated by `useBottomUpDelay` / `useInView` so off-screen or pre-delay cards don't spin. Re-runs only when `[target, duration, decimals, delayMs]` change (all primitives). It replays from 0 on tab-entry because pages remount — that's the intended entrance, not waste.

## 6. Ring geometry that doesn't depend on the animated value is memoised — keep it that way

In `ActivityRing.tsx`'s `OverflowRing`, the annulus clip `bandPath` depends only on `size`/`strokeWidth`, not the per-frame `ratio`, so it's `useMemo([c, rOut, rIn])` — otherwise the count-up roll rebuilds the same path string every frame. Anything that genuinely tracks `ratio` (the arc, the tail angle) is recomputed each frame on purpose. Don't un-memoise the constant parts, and don't memoise the per-frame ones.

## 7. Reduced-motion is handled globally — don't re-implement it

`global.css` has one `@media (prefers-reduced-motion: reduce)` block that collapses every animation/transition to a near-instant end state and zeroes entrance-cascade delays. The JS hooks (`useCountUp`, `useInView`, `useBottomUpDelay`, `useCrossfade`, `useExitTransition`) each already honour it by snapping. Don't add per-component reduced-motion CSS or JS — it's covered.

## 8. Bespoke raw-literal exceptions — don't "fix" them

A short list of expressive one-offs intentionally keep raw values because they're outside the UI-rhythm scale (celebration / ambient / affordance): `save-pulse` 700ms, `day-drag-hint` 1.15s, the Health spark micro-timings (180/320/450ms), `splash-glow` 2400ms / `splash-float` 3200ms, the confetti 22ms per-particle stagger. These are deliberate — leave them. New *UI* motion still uses the role tokens.

## Verifying motion changes

Motion/cosmetic changes are verified with `npx tsc --noEmit` and `npm run lint:css` — **not** the browser preview. (`lint:css` is stylelint + declaration-strict-value; radius/font-size/spacing are token-enforced. Animation durations aren't machine-enforced, so the discipline above is on you.) Never reach for preview screenshotting to check an animation.
