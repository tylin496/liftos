// Muscle-group grid aggregation — the Training Health card's primary detail view.
// Abstracts the per-lift stats already computed for the card into 7-ish muscle
// groups, worst-first, each carrying ONE status/tone. Pure: pass the exercises,
// get the grid cells back. No new judgments — every per-lift status is read off
// the same trusted flags (declining / needsAttention / recovering / fresh-PR)
// the list view used, so the grid can never disagree with a drill-down row.

import type { StrengthExercise } from "@features/overview/strength";
import type { MuscleGroup } from "./muscleGroup";
import { inferMuscleGroup } from "./muscleGroup";
import { suggestDeload } from "./deload";

export type LiftStatus = "declining" | "stalled" | "pr" | "rebounding" | "steady";
export type Tone = "bad" | "warn" | "good" | "gold" | "steady";
/** Non-hero cell height tier, set by the muscle's real-world size. */
export type SizeTier = "lg" | "md" | "sm";

type TrackedGroup = Exclude<MuscleGroup, "unknown">;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Glyph per status — this is CONTENT (screen-readable), not decoration; the
 *  colour is applied by CSS keyed on the status class, never inline. */
export const STATUS_ICON: Record<LiftStatus, string> = {
  declining: "↓",
  stalled: "●",
  pr: "🏆",
  rebounding: "↑",
  steady: "–",
};

// Severity drives BOTH the group's tone (most-severe lift wins) and worst-first
// ordering: an acute slide outranks a chronic stall, a live rebound outranks a
// fresh PR, and steady sinks to the bottom. (Handoff §aggregation.)
const SEVERITY: Record<LiftStatus, number> = {
  declining: 4,
  stalled: 3,
  rebounding: 2,
  pr: 1,
  steady: 0,
};

const STATUS_TONE: Record<LiftStatus, Tone> = {
  declining: "bad",
  stalled: "warn",
  rebounding: "good",
  pr: "gold",
  steady: "steady",
};

// Non-hero cell height ∝ muscle size (bigger muscles read as bigger cells). The
// hero (worst group) ignores this and spans the full row — see MuscleGridCell.
const MUSCLE_SIZE: Record<TrackedGroup, SizeTier> = {
  chest: "lg",
  back: "lg",
  quads: "lg",
  hamstrings: "md",
  shoulders: "md",
  glutes: "md",
  biceps: "sm",
  triceps: "sm",
  calves: "sm",
  abs: "sm",
};

export interface LiftMark {
  slug: string;
  status: LiftStatus;
  icon: string;
}

export interface MuscleGridCell {
  group: TrackedGroup;
  /** Worst retention in the group (min, not mean — a problem lift shouldn't be
   *  diluted by its healthy neighbours). 0–100. */
  pct: number;
  /** Group status = the most-severe lift's status; `tone` is its visual tier. */
  status: LiftStatus;
  tone: Tone;
  /** The worst group renders as a full-row hero cell. */
  hero: boolean;
  sizeTier: SizeTier;
  /** One-sentence insight — the deload next step for flagged groups, else a
   *  short state note. Single-line (the card ellipsizes it). */
  insight: string;
  /** One mark per lift, worst-first — the systemic read at a glance. */
  marks: LiftMark[];
  /** "N lifts" confidence count. */
  count: string;
  /** The group's lifts, worst-first (severity desc, then retention asc). The
   *  drill-down renders these; `lifts[0]` is the worst lift (insight subject). */
  lifts: StrengthExercise[];
}

function retention(ex: StrengthExercise): number {
  return ex.prE1RM > 0 ? ex.latestE1RM / ex.prE1RM : 0;
}

// The steady note speaks the same language as the cell's % (which is "share of
// your best e1RM"): it says how close to YOUR BEST the lift is sitting, in plain
// words — "at your best" only when it's essentially AT the PR, not for any
// steady hold (an earlier "holding peak" overstated a 90%-of-best hold, and
// "peak" read as jargon). Not a PR: a fresh PR is its own gold status
// (see liftStatus); this is the quiet steady tier.
const AT_BEST_RETENTION = 0.99; // at / essentially at the PR
const NEAR_BEST_RETENTION = 0.95; // within ~5% of the PR

/** Steady-tier note by how close the lift sits to its own PR e1RM. Lowercase so
 *  it can trail a status glyph in a drill row; the grid cell upper-cases it. */
export function steadyNote(ex: StrengthExercise): string {
  const r = retention(ex);
  if (r >= AT_BEST_RETENTION) return "at your best";
  if (r >= NEAR_BEST_RETENTION) return "near your best";
  return "holding steady";
}

function weeksAgo(isoDate: string, nowMs: number): number {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((nowMs - t) / WEEK_MS);
}

/** One lift's status, from the same trusted flags the list view read. Order is
 *  the tie-break: an acute slide (declining) leads; a lift flagged for
 *  intervention (needsAttention, but not declining) is stalled; a PR in the past
 *  week is a win; a visible climb-back is rebounding; otherwise it's holding. */
export function liftStatus(ex: StrengthExercise, nowMs: number): LiftStatus {
  if (ex.declining) return "declining";
  if (ex.needsAttention) return "stalled";
  if (weeksAgo(ex.lastPRDate, nowMs) < 1) return "pr";
  if (ex.recovering) return "rebounding";
  return "steady";
}

/** Lowercase the first letter so a deload action reads as a clause after an
 *  em-dash ("Bench declining — ease back to …"), not a second sentence. */
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function buildInsight(status: LiftStatus, worst: StrengthExercise): string {
  switch (status) {
    case "declining":
    case "stalled": {
      const verb = status === "declining" ? "declining" : "stalled";
      const s = suggestDeload(worst); // non-null: both statuses imply needsAttention
      return s ? `${worst.name} ${verb} — ${lowerFirst(s.action)}` : `${worst.name} ${verb}`;
    }
    case "pr":
      return `${worst.name} — new PR this week`;
    case "rebounding":
      return `${worst.name} climbing back`;
    default: {
      const n = steadyNote(worst);
      return n[0].toUpperCase() + n.slice(1);
    }
  }
}

/**
 * Abstract the card's exercises into muscle-group cells, worst-first. Groups
 * with no tracked lifts are simply absent (no placeholder cells). `nowMs` is the
 * render clock, only used to age the fresh-PR window.
 */
export function buildMuscleGrid(exercises: StrengthExercise[], nowMs: number): MuscleGridCell[] {
  const byGroup = new Map<TrackedGroup, StrengthExercise[]>();
  for (const ex of exercises) {
    const g = inferMuscleGroup(ex.name, ex.slug);
    if (g === "unknown") continue; // unknowns are excluded, never guessed into a group
    const arr = byGroup.get(g);
    if (arr) arr.push(ex);
    else byGroup.set(g, [ex]);
  }

  const cells: MuscleGridCell[] = [];
  for (const [group, lifts] of byGroup) {
    // Worst-first within the group: most severe first, ties broken by lower
    // retention. lifts[0] is then both the group's status source and the insight
    // subject, and the marks row reads worst → best left-to-right.
    const withStatus = lifts.map((ex) => ({ ex, status: liftStatus(ex, nowMs) }));
    withStatus.sort(
      (a, b) => SEVERITY[b.status] - SEVERITY[a.status] || retention(a.ex) - retention(b.ex),
    );
    const sorted = withStatus.map((w) => w.ex);
    const status = withStatus[0].status; // most severe
    const pct = Math.round(Math.min(...lifts.map(retention)) * 100);
    const n = lifts.length;
    cells.push({
      group,
      pct,
      status,
      tone: STATUS_TONE[status],
      hero: false, // set after global ordering
      sizeTier: MUSCLE_SIZE[group],
      insight: buildInsight(status, sorted[0]),
      marks: withStatus.map((w) => ({ slug: w.ex.slug, status: w.status, icon: STATUS_ICON[w.status] })),
      count: `${n} ${n === 1 ? "lift" : "lifts"}`,
      lifts: sorted,
    });
  }

  // Worst-first across groups (same severity-then-retention rule); the single
  // worst group is promoted to the full-row hero.
  cells.sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || a.pct - b.pct);
  if (cells.length > 0) cells[0].hero = true;
  return cells;
}
