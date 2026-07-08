---
name: skeleton-design
description: >-
  Reference guide for writing loading skeleton states in this app.
  Covers the content-derived approach: real DOM elements with placeholder
  text + CSS loading class. Load this when implementing or auditing skeleton
  states. The old "skel span" approach is obsolete — do not use it.
---

# Skeleton Design: Content-Derived Skeletons

## Core principle

**Loaded layout === Skeleton layout.**

Skeletons are not separate markup. They are the real element structure with
placeholder text, scoped by a CSS loading class that makes data values
transparent and applies a shimmer. The only difference between skeleton and
loaded state is: content visible vs content loading.

This eliminates layout drift when typography changes, removes maintenance
overhead, and guarantees accurate font-derived dimensions.

**Exception: complex visualizations.**
Charts, graphs, and canvas-based elements may use a dedicated placeholder
block rather than rendering the real visualization DOM in a loading state.
A single flat `.skel` block at chart height is used instead. Everything
outside the chart area still follows the real-DOM rule.

## Visual weight principle

The loading state must be visually quieter than the loaded state.

Skeletons exist to preserve layout and communicate that data is on its way.
They should never attract more attention than the content they represent.
If a skeleton feels heavier, denser, or more visually dominant than the
loaded UI, the shimmer values are too aggressive — lower the gradient opacity
or increase the animation duration until the skeleton recedes.

---

## Height stability — the most important rule

**The skeleton must be the same height as the loaded card. Every element
that contributes height in the loaded state must also be present in the
skeleton.**

### Conditional renders cause layout jumps

The most common mistake: a section is conditionally rendered in the loaded
state (`{hasEntry && <div>...</div>}`) and simply omitted from the skeleton.
When data loads and the condition becomes true, the card grows — a jarring
jump.

**Fix: always render, use `visibility: hidden` to suppress.**

```jsx
// ✗ Wrong — pill row absent from skeleton, card grows on load
{hasEntry && (
  <div className="nutri-pill-row">
    <span className="nutri-pill">On Plan</span>
  </div>
)}

// ✓ Correct — pill row always rendered, hidden until there's an entry
<div className={`nutri-pill-row${!hasEntry ? " nutri-pill-row--empty" : ""}`}>
  <span className={`nutri-pill nutri-pill-${hasEntry ? pillState : "under"}`}>
    {hasEntry ? pillLabel(...) : "On Plan"}
  </span>
</div>
```

```css
.nutri-pill-row--empty { visibility: hidden; }
```

This applies to **any** conditionally-rendered section that affects height:
status pills, balance rows, attention lists, detail sections.

### Image / media placeholder areas

Non-text visual areas (exercise images, avatars) take up layout space even
when empty. Include a placeholder div with the same size class, even if it
has no content:

```jsx
// ✗ Wrong — missing image area makes card shorter than loaded state
<div className="ex-body-content">...</div>

// ✓ Correct — empty div preserves the 120×120 layout slot
<div className="ex-body-content">...</div>
<div className="ex-ident-wrap" />
```

### Render in place — do NOT use a separate skeleton branch

**Default for every stable card: the same component stays mounted across the
loading → loaded transition, toggling a `loading` prop.** Do NOT render
`{!data && <skeletonBranch/>}` beside `{data && <realBranch/>}`.

Why: a separate skeleton subtree is a *different set of DOM nodes* from the
loaded subtree. When data lands, React unmounts the skeleton and mounts the
real cards — so the page-entrance animation (`.page > * { animation: rise-in }`)
**replays a second time** (the skeleton's was interrupted mid-flight), and the
placeholder→real content swap jumps. That double-entrance flash — "skeleton
appears, vanishes half-animated, real cards fade in again" — is exactly what
in-place rendering prevents.

The in-place pattern (canonical example: `NutritionInsightCard.tsx`):

```jsx
export function Card({ data }) {
  const loading = !data;                      // or a dedicated `loading` prop
  return (
    <section className={`page-card foo${loading ? " loading-card" : ""}`}>
      <span className="foo-num">{loading ? "0,000" : data.value.toLocaleString()}</span>
      {/* count-up / roll children render only when !loading, so they play
          ONCE in place when data lands — not on the placeholder */}
    </section>
  );
}
// Page: <Card data={data} />  — always mounted, never `{data && <Card/>}`.
```

Rules that make in-place work:
- **Hooks run unconditionally, before any `loading` early-return** — the hook
  count must not change between loading and loaded (same mounted instance).
- **Keep the root tag stable** (don't switch `<div>`↔`<button>` between states)
  or React replaces the node and the entrance replays for that card.
- **Give sibling cards stable `key`s** when a conditional card (e.g. an alert
  banner) can appear on load — otherwise it shifts positions and index-based
  reconciliation remounts everything below it.
- A `useState` initializer that reads data (e.g. a once-per-load celebration)
  won't re-run when data lands — move it to a `useEffect` keyed on the data.

### The ONE exception: genuinely dynamic lists

A separate skeleton branch is correct **only** when the loaded output is a
*list whose item count and identity aren't known until data arrives* — e.g.
the Training exercise cards (3 placeholders → N different real cards). You
cannot resolve N distinct cards from 3 placeholders in place, so the list
renders `{!items && <NPlaceholders/>}` then `{items.map(...)}`. Everything
*around* the list (headers, a summary card at the bottom) still renders in
place. When you use this exception, keep the skeleton branch manually in sync:
whenever you add a section to the loaded list area, ask "is a matching
placeholder present?"

---

## How it works

### 1. Skeleton HTML — real structure, placeholder values

Render the real DOM with placeholder text that matches the expected character
count at that font size:

```jsx
// Numbers: same digit count as the real value at that font size
<span className="stat-number">0000</span>   // "2,050" = 4 chars
<span className="stat-number">000</span>    // "196"   = 3 chars
<span className="ov-hero-num">0,000</span>
<span className="ov-hero-denom">/ 0,000 kcal</span>
```

Use JetBrains Mono (the app's monospace font) — tabular numbers mean
`"0000"` and `"2,050"` render at the same width.

Static labels ("CALORIES", "PROTEIN", "On Plan", etc.) stay as real visible
text. They anchor the layout and tell the user what's loading.

### 2. Scoping class

Apply `loading-card` to the outermost element of the card being loaded.

```jsx
// Whole-page load — section gets loading-card
<section className={`page-card ov-hero${!data ? " loading-card" : ""}`}>

// Inline state on a persistent element
<button className={`nutri-tap-card${loading ? " loading-card" : ""}`}>
```

### 3. CSS — transparent + shimmer on data selectors

**Color token:** this app uses `--ink-4`, not `--muted`.

```css
.loading-card .ov-hero-num,
.loading-card .ov-hero-denom,
.loading-card .ov-stat-val {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;   /* required for WebKit */
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ink-4) 10%, transparent) 0%,
    color-mix(in srgb, var(--ink-4) 19%, transparent) 50%,
    color-mix(in srgb, var(--ink-4) 10%, transparent) 100%
  ) !important;
  background-size: 300% 100% !important;
  border-radius: 0.3em !important;
  animation: skel-shimmer 2.2s ease-in-out infinite !important;
}
```

Both `color` and `-webkit-text-fill-color` must be set. Elements with an
explicit `-webkit-text-fill-color` in their own rule will ignore
`color: transparent` without it.

**Child-inside-parent rule:** if an element is rendered *inside* another
shimmer'd element, do NOT add it to the main shimmer selector group. Give it
its own rule that sets only `color`/`-webkit-text-fill-color` transparent and
`background: transparent`. Putting the child in the same group gives it its
own gradient block, visually overlapping the parent.

```css
/* unit span lives inside a shimmer'd parent — text-transparent only */
.loading-card .health-tdee-num .health-unit,
.loading-card .health-metric-hero .health-unit {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  background: transparent !important;
}
```

**Full-width flex child in a gap:0 grid:** bars touch edge-to-edge and read
as one. Fix with `padding-right` + `background-clip: content-box`.

### 4. Animation timing consistency

All shimmer in the app must use the **same duration**. The global `.skel`
block (used for chart placeholders) and all `loading-card` CSS rules must
match. Current standard: **`2.2s ease-in-out`**.

If you add a `.skel` chart placeholder inside a `loading-card`, verify that
`layout.css`'s `.skel` animation duration matches the feature CSS. They
diverged once (1.8s vs 2.2s) and looked broken within the same card.

### 5. Copy / action buttons in loading state

```css
.loading-card .copy-phase-header-btn,
.loading-card .card-actions { visibility: hidden; }
```

Buttons are hidden during skeleton, not shimmer'd. They have no placeholder
concept and add visual noise without anchoring anything.

---

## What to skeletonize vs. keep visible

| Element | Action |
|---|---|
| Hero numbers (calories, %, streak) | Shimmer — placeholder text |
| Unit strings inline with hero ("kcal", "g", "%") | Shimmer |
| KPI / stat values | Shimmer |
| Unit children inside shimmer parent | Text-transparent only, `background: transparent` |
| Static labels ("CALORIES", "PROTEIN") | Keep visible — semantic anchors |
| Dynamic labels ("Deficit" / "Surplus") | Keep visible with neutral placeholder text |
| Section headings that are dynamic ("Today", month name) | Shimmer |
| Section headings that are always static | Keep visible |
| Status pills | Always render; `visibility: hidden` when no entry (not omitted) |
| Progress / distribution bars | Keep at 35% width, opacity 0.3 — do not shimmer |
| Image / media areas | Render empty placeholder div with same size class |
| Chart / graph areas | Single `.skel` block at chart height (complex visualization exception) |
| Copy / action buttons | `visibility: hidden` |
| Card shell chrome (nav buttons, borders) | Always visible |

---

## Per-section patterns (LiftOS)

Overview, Health, and the Training summary card all render **in place**: each
card component is always mounted and takes a `loading` prop, showing the
markup below while loading and resolving the same DOM to real values when data
lands (see "Render in place" above). The snippets show the loading-state
content each card renders — not a separate skeleton subtree.

### Overview card (loading-state content)

```jsx
// Inside the card component: return this shell when `loading`, the real values
// otherwise. The <section> stays the same mounted node across the transition.
<section className="page-card ov-hero loading-card">
  <p className="ov-hero-eyebrow">Today · {fmtDate()}</p>
  <div className="ov-hero-row">
    <span className="ov-hero-label">Calories</span>
    <div className="ov-hero-values">
      <span className="ov-hero-num">0,000</span>
      <span className="ov-hero-denom">/ 0,000 kcal</span>
    </div>
    <div className="ov-bar-track">
      <div className="ov-bar-fill" style={{ width: "35%", opacity: 0.3 }} />
    </div>
  </div>
  <div className="ov-hero-row">
    <span className="ov-hero-label">Protein</span>
    <div className="ov-hero-values">
      <span className="ov-hero-num">000</span>
      <span className="ov-hero-denom">/ 000 g</span>
    </div>
    <div className="ov-bar-track">
      <div className="ov-bar-fill protein" style={{ width: "35%", opacity: 0.3 }} />
    </div>
  </div>
  {/* Always include the balance row — it's conditional in loaded state
      but must be present in skeleton to preserve card height */}
  <div className="ov-hero-balance">
    <span className="ov-hero-label">Deficit</span>
    <span className="ov-hero-balance-num good">−000 kcal</span>
  </div>
</section>
```

### Training exercise list — the dynamic-list exception

This is the ONE place that keeps a separate skeleton branch (see "The ONE
exception" above): the loaded output is N different exercise cards, which can't
resolve in place from a fixed placeholder count. Skeleton renders 3 placeholder
`ex-card` articles. Include `ex-ident-wrap` even empty — it's a 120×120 layout
slot that affects card height. (The Training Health summary card *below* the
list is stable, so it renders in place with a `loading` prop like everything
else — only the list itself is the exception.)

```jsx
{!exercises && !error && (
  <>
    {[0, 1, 2].map((i) => (
      <article key={i} className="ex-card loading-card">
        <div className="ex-title-block">
          <div className="ex-title-row">
            <h3 className="ex-name">Exercise Name</h3>
          </div>
          <div className="ex-meta-row" />
        </div>
        <div className="ex-body">
          <div className="ex-body-content">
            <div className="ex-pr-inline">
              <div className="pr-top-row">
                <span className="pr-weight">00.0 kg</span>
                <span className="pr-meta mono">×00</span>
              </div>
            </div>
          </div>
          <div className="ex-ident-wrap" />  {/* preserves image layout slot */}
        </div>
        <div className="ex-history">
          {[0, 1, 2].map((j) => (
            <div key={j} className="hist-row">
              <span className="hist-date">
                <span className="hist-date-mon">JAN</span>
                <span className="hist-date-day mono">00</span>
              </span>
              <span className="hist-expr">
                <span className="hist-expr-row">00.0 kg × 00</span>
              </span>
            </div>
          ))}
        </div>
      </article>
    ))}
  </>
)}
```

### Nutrition today card

The card is always mounted. Apply `loading-card` as a class toggle. Status
pill is always rendered — hidden via `nutri-pill-row--empty` when no entry.

```jsx
<button className={`nutri-tap-card${loading ? " loading-card" : ""}`}>
  <div className={`nutri-pill-row${!hasEntry ? " nutri-pill-row--empty" : ""}`}>
    <span className={`nutri-pill nutri-pill-${hasEntry ? pillState : "under"}`}>
      {hasEntry ? pillLabel(...) : "On Plan"}
    </span>
  </div>
  {/* rest of card — same DOM regardless of loading state */}
</button>
```

```css
.nutri-pill-row--empty { visibility: hidden; }
```

### Health trend cards

The trend cards render **in place**: `TrendCard` is a single reusable component
that takes a `loading` prop. The page always mounts the same stable set (Weight,
Body Fat, Lean Mass, Recovery) — no `{!data && ...}` skeleton branch — passing
`loading={!data}` and placeholder values while loading, real values when data
lands. A metric with no reading yet shows `—` (never unmounts, so no jump). The
sparkline area uses a `.skel`-style placeholder while loading (complex-viz
exception); its shimmer duration must match `loading-card` (2.2s).

```jsx
// Page: always mounted, same instances across loading → loaded.
{METRICS.map((spec) => {
  const c = cards.find((x) => x.spec.key === spec.key);   // undefined while loading
  return (
    <TrendCard
      key={spec.key}
      loading={!data}
      label={spec.label}
      value={c ? c.thisWeek : null}     // null → "—" when loaded but no data
      points={c ? c.bucketed : []}
      /* ...unit / decimals / delta ... */
    />
  );
})}

// Inside TrendCard: one shell, values gated on `loading`.
<section className={`page-card health-trend${loading ? " loading-card" : ""}`}>
  {loading
    ? <MetricValue size="lg" unit={unit}>00.0</MetricValue>
    : value != null
      ? <MetricValue size="lg" unit={unit}><AnimatedMetric value={value} /></MetricValue>
      : <MetricValue size="lg">—</MetricValue>}
  {/* ... */}
</section>
```

---

## Shimmer animation

```css
@keyframes skel-shimmer {
  0%   { background-position: -100% 0; }
  100% { background-position:  100% 0; }
}
```

Standard timing: **2.2s ease-in-out**. All shimmer in the app uses this —
including the global `.skel` block in `layout.css`.

Tuning:
- Too heavy? Lower `19%` → `14%`
- Too subtle? Raise `10%/19%` → `12%/22%`
- Too fast/harsh? Increase duration `2.2s` → `2.6s`

---

## When NOT to use skeleton

**Skeleton is exclusively for async loading states** — when data is being
fetched from a server or API and the UI must wait for it to arrive.

Do NOT apply skeleton to:

- **Empty / placeholder states** — the user hasn't made a selection yet.
  Use a descriptive prompt instead.
- **Zero-data states** — no history, no results yet. Show an empty-state message.
- **Optional fields** — a field that is intentionally blank is not loading.

**Rule of thumb:** if there is no in-flight network request, there should be
no skeleton.

---

## Anti-patterns

- **Separate skeleton branch for a stable card** — `{!data && <skel/>}{data && <real/>}` unmounts one subtree and mounts another, replaying the page entrance and jumping the swap. Render in place with a `loading` prop instead. (Only genuinely dynamic lists — Training exercises — may keep a separate branch.)
- **Switching the root tag between loading and loaded** (`<div>`↔`<button>`) — replaces the node, so the entrance replays for that card. Keep the tag stable.
- **`useState` initializer that reads data in an in-place card** — it runs once at mount (while loading, data absent) and never re-fires when data lands. Use a `useEffect` keyed on the data.
- **Hardcoded `width`/`height` on skel spans** — breaks when font-size changes
- **Shimmer on static labels** — "CALORIES", "On Plan" etc. should stay visible as anchors
- **7 fake chart bars** — they merge into a dark block; use one flat `.skel` instead
- **`display: none` for icon swap** — use opacity/transform crossfade instead
- **Filling copy button with skel** — it has no placeholder; just hide it
- **Shimmer on empty/placeholder states** — skeleton is for loading, not "nothing selected yet"
- **Omitting conditional sections from skeleton** — causes card to grow on load; use `visibility: hidden` instead
- **Omitting image/media placeholder divs** — card is shorter during loading; render empty div with size class
- **Mismatched shimmer timing** — `.skel` block and `loading-card` CSS must use same duration
- **Using `--muted` color token** — this app uses `--ink-4`; check tokens.css before writing gradient
