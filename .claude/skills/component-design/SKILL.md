---
name: component-design
description: >-
  Component standards for this app. Canonical markup, CSS class names,
  icon assets, interaction states, and size variants for reusable UI pieces.
  Load this when implementing or auditing buttons, icons, or interactive
  components. Covers: copy button family.
---

# Component Design Standards

## Copy button

### Component class

All copy buttons use `copy-phase-header-btn`. One component, two size tiers.

### Canonical markup

```html
<button class="copy-phase-header-btn" type="button" aria-label="Copy …">
  <span class="copy-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  </span>
  <span class="check-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  </span>
</button>
```

**SVG rules:**
- No `width`/`height` attributes on any SVG element — sized by CSS container only
- `stroke="currentColor"` — icon color always inherits from context
- `stroke-width="2"` on both copy and checkmark SVGs — do not vary this

**Do not use the old filled two-rect SVG** (`fill="currentColor"`, two `<rect>` elements, `opacity="0.5"`). That was the pre-unification asset and is obsolete.

### Size tiers

| Context | Container | Icon | Selector |
|---|---|---|---|
| Section header (This Week, Today, Monthly) | 30×30px | 13px | `.copy-phase-header-btn` |
| App header | 32×32px | 16px | `button.copy-all-data-btn` (element+class for specificity) |

Container size is set on `.copy-phase-header-btn` (30px baseline). App header overrides via:
```css
button.copy-all-data-btn { width: 32px; height: 32px; }
.copy-all-data-btn .copy-icon,
.copy-all-data-btn .check-icon { width: 16px; height: 16px; }
```

### Color

`color: inherit` on the button — icon color matches the heading/text it sits next to.
No separate muted gray. Visual hierarchy comes from size, not opacity.

### Copied state

Add `.copied` class to the button. Remove after ~2s.

```css
/* icon crossfade — opacity + transform, never display:none */
.copy-phase-header-btn .check-icon { opacity: 0; transform: scale(0.5); }
.copy-phase-header-btn.copied .copy-icon { opacity: 0; transform: scale(0.5) rotate(-10deg); }
.copy-phase-header-btn.copied .check-icon { opacity: 1; transform: scale(1); }
.copy-phase-header-btn.copied { color: var(--success-text); }
```

Both icons use `grid-area: 1/1` so they occupy the same cell and crossfade cleanly.

### In skeleton / loading state

```css
.loading-card .copy-phase-header-btn { visibility: hidden; }
```

Hidden — not shimmer'd. See `[[skeleton-design]]` for loading state rules.
