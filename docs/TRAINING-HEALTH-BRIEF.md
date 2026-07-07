# Training Health Card — Redesign Brief (for design)

Hand-off brief. Self-contained — the design session needs no prior context.

## 1. What it is

A card in a mobile fitness app (LiftOS, ~400px phone frame) that answers ONE
question for a lifter: **"which of my lifts need attention, and what's worth
celebrating?"** It is decision support, **not** a data dashboard.

Two renders of the *same* data:
- **Summary** — on the Overview (home) tab. Glanceable status; taps → Training.
- **Detailed** — on the Training tab. The full breakdown.

Design both.

## 2. The product philosophy (the spine — don't violate)

1. **Only surface signals.** Show a lift ONLY if it's a **warning** (needs
   intervention) or a **reward** (worth celebrating). A lift that's just
   *maintaining* its level is **not shown**. Normal = invisible. This is the
   whole point — a decision tool, not a list of everything.
2. **Retention (distance from personal best) is the primary judgment**, NOT
   "weeks since PR". A lift can go 20 weeks without a PR and be perfectly fine if
   it's holding at its best (normal for isolation lifts). Never warn on staleness
   alone.
3. **Only two kinds of trend are trusted.** The user logs *asymmetrically* — they
   mostly record a session when they DROP or PR; ordinary "same as always" days go
   unlogged. So the sample is biased toward dips. Therefore:
   - **Distance from all-time peak** (retention) → trusted.
   - **Consecutive monotonic runs** — a 3-session climb or slide in the *actual
     records* → trusted in BOTH directions (a run survives the logging bias).
   - A **fuzzy regression slope** → NOT trusted, never used (the bias reads it as
     "declining" even while maintaining).
4. **Celebrate proportionally.** Not every PR deserves confetti — frequency
   control prevents reward fatigue.

## 3. Data available per lift

Computed upstream (`overview/strength.ts`); the card is pure render.

| field | meaning |
|---|---|
| `name` | display name |
| `retention` (0–1) | latest session's e1RM ÷ all-time best e1RM = how close to peak |
| `status` | `improving` (≥99.7% of PR) / `stable` (94–99.7%) / `watch` (<94%) |
| `stalledWeeks` | weeks since the last PR on **either** axis (see §5) |
| `lastPRDate` | date of that last PR — drives "PR this week" |
| `lastLogDate` | date of most recent session — drives a "logged Nw ago" staleness hint |
| `needsAttention` | the flag: chronic plateau OR acute decline (see §4) |
| `recovering` | last 3 sessions climbing back (self-correcting) |
| `declining` | last 3 sessions sliding down (acute) |
| `compound` | is it a barbell/compound lift (milestones fire only for these) |

Aggregate: `total` (tracked lifts), and a mean retention across all lifts.

## 4. The states to represent

**Warnings**
- **Needs Attention** — below peak AND stalled for weeks (chronic plateau).
  Real example: Squat at 78% of best, 38 weeks stuck.
- **Declining ↓** — the last few sessions are consecutively dropping (an acute
  slide, e.g. losing strength mid-cut). Fires **immediately**, even near peak, and
  is **more urgent** than a chronic plateau.

**Rewards**
- **Fresh PR this week 🔥** — set a new record (new e1RM *or* new heaviest weight)
  in the past 7 days.
- **Rebounding ↑** — was below peak, now climbing back over the last few sessions
  (self-correcting; rescued from the warning list).

**Hidden (no row)**
- **Maintaining at peak** (~100% retention) — good, but not a fresh achievement,
  so it's *normal* → don't show it. (100% ≠ "just PR'd"; it means "matched your
  best", which is the default healthy state.)
- **Neutral** (mid-range, nothing happening) → don't show.

## 5. PR taxonomy (language for the "reward" states)

Two axes, because the strength estimate (Epley e1RM) is blind to a heavier top set:
- 🏆 **Strength PR** — a new estimated-1RM ceiling.
- 💪 **Performance PR** — heaviest weight ever completed, OR more total reps at a
  tied ceiling. e.g. `77kg×7` when it ties the e1RM of `75kg×8` — real progress
  Epley rates as flat.
- 🎯 **Milestone** — crossing a round weight (100kg, 105kg…) on a compound lift.

("Fresh PR this week" on the card counts Strength OR Performance PRs.)

## 6. Aggregate (hero + bar) — keep this

- **Hero**: a big % = **average retention across all tracked lifts** (e.g. `94%`).
  Rendered in **neutral ink** — the verdict colour lives on the bar/rows, not the
  hero number.
- **Subline**: `N of M tracked lifts on track`.
- **Segmented bar**: M cells, N green + the rest grey. (Cells currently cascade in
  on entrance — keep some life here.)

## 7. The two versions

### A. Summary (Overview tab)
- Hero % + subline + segmented bar.
- **ONE** summary line, chosen by priority:
  `acute decline > fresh PR(s) this week > lifts needing attention > all clear`.
- Whole card taps → Training tab. Very compact, no lists.

### B. Detailed (Training tab)
- Same hero + bar.
- Then **only the signal rows**:
  - **Warnings** — Needs Attention + Declining (worst first). Declining is the
    more urgent read; consider a distinct ↓ treatment.
  - **Rewards** — fresh PRs 🔥 + Rebounding ↑.
  - **Everything neutral / at-peak is NOT listed** — it only feeds the aggregate.
- Each row taps → that lift's **trend chart** (a sparkline sheet already exists) —
  a declining lift should be reviewable.

## 8. Concrete example (real user data)

| lift | retention | weeks | → card |
|---|---|---|---|
| Squat | 78% | 38 | **Needs Attention** (chronic) |
| Leg Curl | 85% | — | **Rebounding ↑** (climbing back) |
| Bench Press | 100% | PR'd this wk | **🔥 fresh Performance PR** (77×7) |
| RDL, Low Row, Pec Deck, … (×7) | 100% | — | **hidden** (maintaining) |

So the detailed card here would show ~3 rows, not 15. That's the goal.

## 9. Constraints / design system

- Mobile-first. Reuse existing tokens: `tokens.css` (colour/space/radius/type),
  `--role-*` text roles, `--metric-*` for numbers.
- Colour semantics: green = good, amber = caution, red = bad. **GOLD is
  celebration-only** — never for status.
- Labels in **English**.
- Existing class prefix `ov-th-*` and an entrance cascade on the bar.

## 10. Decided direction (resolved with product)

1. **The ~7 at-peak lifts** → **one collapsible "N holding peak" row**, collapsed
   by default. Not seven rows (clutter), not fully hidden (keep a quiet positive
   clue). Tap to expand the list.
2. **Declining vs Needs Attention** → **one Warnings section**, sorted worst-first
   so the acute ↓ slides sit on top; each declining row carries a distinct **↓**
   marker. No second header — order + marker carry acute-vs-chronic.
3. **Reward in the detailed card** → a compact **Rewards section BELOW Warnings**
   (🔥 fresh PR + ↑ Rebounding). Problems lead (decision tool); positives follow.
4. **PR taxonomy** → **distinguish the three types with an icon** (🏆 Strength /
   💪 Performance / 🎯 Milestone), minimal label. Honours the two-axis work
   (77kg×7 is a *Performance* PR, not Strength). Needs the PR *type* surfaced per
   lift (small data addition).

Extra constraints: a declining row taps → its **trend chart** (reviewable); GOLD
stays celebration-only; reuse the **Recovery card's** visual language; keep the
"logged Nw ago" staleness hint.

Thresholds (what % / how many weeks) are still being calibrated on real data — so
design the **states**, never hard-code the numbers.

## 11. Exploration ask

Produce **two directions** to compare (the philosophy is locked — not three). They
should differ mainly on:
- **Warnings / Rewards zoning & hierarchy** — how the two groups are arranged and
  weighted against each other.
- **Row information density** — what each row shows (retention % vs weeks vs a
  status marker).

Keep the **hero + segmented bar** consistent across both directions.
