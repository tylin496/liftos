import { useEffect, useRef, useState } from "react";
import { useNavExpand } from "@app/layout/NavContext";
import { MetricValue } from "@shared/components/Metric";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import type { StrengthSummary, StrengthExercise } from "../overview/api";
import "./strengthHealthCard.css";

// On-track rows show "% of all-time PR" (how close to your best). Flagged
// (watch) rows instead carry a stalled readout counting whole weeks since
// the last new best — that's what actually earned the flag, and it reads
// clearer than a % that could look like a contradiction (e.g. "97% · Review").
function exerciseRetention(ex: StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weeksAgo(isoDate: string, nowMs: number): number {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((nowMs - t) / WEEK_MS);
}

// ── Snapshot summary line: a tiny decision engine, not a fixed readout ───────
// The Overview snapshot carries ONE line, chosen by importance:
//   1. an ACUTE decline  → a lift is consecutively sliding right now. It leads —
//      a live slide (e.g. losing strength mid-cut) is the most time-sensitive
//      thing to surface, more than a celebration. (bar/count stay green-dominant,
//      so the whole card still doesn't read as bad news.)
//   2. a fresh PR this week → the most rewarding signal when nothing's sliding.
//   3. everything on track  → nothing flagged, say so plainly.
//   4. lifts need attention → the honest fallback (chronic plateaus).
// Every branch is derivable from the snapshot alone — we never infer a fuzzy
// slope; only the trusted `declining` run and distance-from-peak.
type SnapshotHighlight =
  | { kind: "declining"; name: string }
  | { kind: "pr"; count: number }
  | { kind: "clear" }
  | { kind: "attention"; count: number };

function snapshotHighlight(
  exercises: StrengthExercise[],
  attention: number,
  nowMs: number,
): SnapshotHighlight {
  // Acute decline leads — the most urgent read. Name the worst (lowest retention).
  const declining = exercises.filter((e) => e.declining);
  if (declining.length > 0) {
    const worst = [...declining].sort((a, b) => exerciseRetention(a) - exerciseRetention(b))[0];
    return { kind: "declining", name: worst.name };
  }
  // Fresh PR = a PR on EITHER axis landed within the past week (counts Performance
  // PRs — a heavier top set Epley rates flat — and survives a later lighter session).
  const freshPRs = exercises.filter((e) => weeksAgo(e.lastPRDate, nowMs) < 1).length;
  if (freshPRs > 0) return { kind: "pr", count: freshPRs };
  if (attention === 0) return { kind: "clear" };
  return { kind: "attention", count: attention };
}

// A row's mini trend line — the last few session e1RMs drawn small, coloured by
// state (red slide / amber plateau / green climb). Fed real session bests; nodes
// stay round (explicit width/height, no preserveAspectRatio="none").
function Sparkline({ bests, tone }: { bests: number[]; tone: "bad" | "warn" | "good" }) {
  const pts = bests.slice(-6);
  if (pts.length < 2) return null;
  const W = 56, H = 20, PAD = 3;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const stepX = (W - PAD * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = coords[coords.length - 1].split(",");
  return (
    <svg className={`ov-th-spark ov-th-spark--${tone}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <polyline points={coords.join(" ")} fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.4" />
    </svg>
  );
}

// A warning row — two lines: name + mini trend (top), marker + note + retention%
// (bottom). Declining ↓ (acute, red) and plateau ● (chronic, amber) share one
// section; colour does the sorting. Weeks is demoted to the caption — retention%
// is the headline number (the primary judgment, not staleness). Tap → trend chart.
function WarningRow({
  exercise,
  onJump,
}: {
  exercise: StrengthExercise;
  onJump?: (slug: string) => void;
}) {
  const acute = exercise.declining;
  const tone: "bad" | "warn" = acute ? "bad" : "warn";
  const pct = Math.round(exerciseRetention(exercise) * 100);
  const wk = exercise.stalledWeeks;
  // The note is the whole story of the row — no separate staleness hint (weeks is
  // folded in here, retention% is the headline on the right).
  const note = acute
    ? "Declining · last 3 sessions"
    : `Stalled · ${wk} ${wk === 1 ? "wk" : "wks"} since PR`;
  const body = (
    <>
      <span className="ov-th-wrow-name">{exercise.name}</span>
      <span className="ov-th-wrow-spark">
        <Sparkline bests={exercise.recentBests} tone={tone} />
      </span>
      <span className="ov-th-wrow-meta">
        <span className={`ov-th-wrow-marker ov-th-wrow-marker--${tone}`} aria-hidden>
          {acute ? "↓" : "●"}
        </span>
        <span className="ov-th-wrow-note">{note}</span>
      </span>
      <span className={`ov-th-wrow-pct ov-th-wrow-pct--${tone}`}>{pct}%</span>
    </>
  );
  return onJump ? (
    <button type="button" className="ov-th-wrow ov-th-wrow--tap" onClick={() => onJump(exercise.slug)}>
      {body}
    </button>
  ) : (
    <div className="ov-th-wrow">{body}</div>
  );
}

// A reward row — single line. Fresh PR (🏆 strength / 💪 performance) with a
// "🔥 this week" chip, or a Rebounding ↑ climb shown with its green sparkline.
function RewardRow({
  exercise,
  rewardKind,
  onJump,
}: {
  exercise: StrengthExercise;
  rewardKind: "pr" | "rebounding";
  onJump?: (slug: string) => void;
}) {
  const isPR = rewardKind === "pr";
  const strong = exercise.lastPRKind === "strength";
  const icon = isPR ? (strong ? "🏆" : "💪") : "↑";
  const note = isPR
    ? strong
      ? "Strength PR · new best e1RM"
      : `Performance PR · ${exercise.lastPRDetail}`
    : "Rebounding · climbing back";
  const body = (
    <>
      <span className={`ov-th-rrow-icon${isPR ? "" : " ov-th-rrow-icon--up"}`} aria-hidden>{icon}</span>
      <span className="ov-th-rrow-name">{exercise.name}</span>
      <span className="ov-th-rrow-note">{note}</span>
      {isPR ? (
        <span className="ov-th-rrow-chip">🔥 this week</span>
      ) : (
        <span className="ov-th-rrow-right">
          <Sparkline bests={exercise.recentBests} tone="good" />
          <span className="ov-th-rrow-pct">{Math.round(exerciseRetention(exercise) * 100)}%</span>
        </span>
      )}
    </>
  );
  return onJump ? (
    <button type="button" className="ov-th-rrow ov-th-rrow--tap" onClick={() => onJump(exercise.slug)}>
      {body}
    </button>
  ) : (
    <div className="ov-th-rrow">{body}</div>
  );
}

// Maintaining / neutral lifts carry no signal, so they don't get rows — they'd be
// the noise this redesign removes. Collapsed to ONE "N holding peak" line; tap to
// reveal them as name chips (a quiet clue, not a list you scroll past).
function HoldingPeak({
  exercises,
  open,
  onToggle,
}: {
  exercises: StrengthExercise[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="ov-th-holding">
      <button type="button" className="ov-th-holding-head" onClick={onToggle} aria-expanded={open}>
        <span className="ov-th-holding-label">{exercises.length} holding peak</span>
        <svg
          className={`ov-th-sect-chevron${open ? " open" : ""}`}
          width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`ov-th-holding-reveal${open ? " open" : ""}`}>
        <div className="ov-th-holding-chips">
          {exercises.map((e) => (
            <span key={e.slug} className="ov-th-chip">{e.name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hero % counts up alongside the segmented bar, on the same bottom-up clock as
// the rest of the page. Blank until its tier delay is known, so it rolls from 0
// rather than flashing the final value.
function RetentionPctRoll({ target, delayMs }: { target: number; delayMs: number }) {
  const pct = useCountUp(target, COUNT_UP_MS, 0, delayMs);
  return <>{pct == null ? "" : `${pct}%`}</>;
}

function RetentionPct({ target }: { target: number }) {
  const { ref, delayMs } = useBottomUpDelay<HTMLSpanElement>();
  if (delayMs == null) return <span ref={ref} />;
  return <RetentionPctRoll target={target} delayMs={delayMs} />;
}

export interface StrengthHealthCardProps {
  /** Absent while loading — the card renders its in-place skeleton instead. */
  strength?: StrengthSummary;
  /** "snapshot" = Overview (hero + bar + one summary line, taps to Training).
   *  "full" = Training tab (same header, detail lists shown inline). */
  variant: "snapshot" | "full";
  /** Only meaningful for the snapshot — taps navigate to Training. */
  onNav?: () => void;
  /** Only meaningful for the full card — lets Overview's nav scroll straight
   *  to it (NavContext's scrollTo target) instead of landing at the tab top. */
  id?: string;
  /** Cold-load: render the same DOM with placeholder values + shimmer, so the
   *  card resolves in place instead of unmounting a separate skeleton. */
  loading?: boolean;
  /** Full variant only — tapping a lift row jumps to its card in the list and
   *  opens its Trend. Wired by the Training page; absent = rows aren't tappable. */
  onJumpToExercise?: (slug: string) => void;
}

export function StrengthHealthCard({
  strength,
  variant,
  onNav,
  id,
  loading = false,
  onJumpToExercise,
}: StrengthHealthCardProps) {
  // Hooks run unconditionally, before any early return, so the count stays
  // stable across the loading → loaded transition (same mounted instance).
  // On Track defaults collapsed — it's reassurance, not urgent. Needs Attention
  // is always shown expanded: if something needs attention, that's the whole
  // point of the card, not something to tuck behind a tap.
  // Exception: when deep-linked from Overview's snapshot (nav passes
  // expand: true), open On Track on arrival — coming from Overview means you
  // want the full detail, not the summary. Captured once at mount.
  const navExpandTarget = useNavExpand();
  const isNavTarget = variant === "full" && id != null && navExpandTarget === id;
  const [trackOpen, setTrackOpen] = useState(isNavTarget);
  const trackSectionRef = useRef<HTMLDivElement>(null);
  // Open On Track when deep-linked from Overview. The initial state covers a cold
  // (remounted) entry; this effect covers a WARM one — the card stays mounted, so
  // it never re-reads the initial state, but the nav-expand signal still flips to
  // this id and should open the section. One-way: it opens on the signal and
  // ignores the later clear, so a manual collapse afterwards sticks.
  useEffect(() => {
    if (isNavTarget) setTrackOpen(true);
  }, [isNavTarget]);
  // Deep-link alignment (landing on this card when nav'd from Overview) is
  // owned by Shell — it pins the target through the skeleton→data layout shift
  // for every deep-link target, so no per-card re-pin is needed here.

  // In-place skeleton: same header + hero + bar + fold structure with
  // placeholder values, tag kept stable per variant (button/div) so the node
  // isn't replaced when data lands. Same DOM the loaded card uses below.
  if (loading || !strength) {
    const skelHeader = (
      <div className="ov-th-top">
        <span className="ov-th-label">Training Health</span>
        {variant === "snapshot" && <span className="ov-th-chevron" aria-hidden>›</span>}
      </div>
    );
    const skelBody = (
      <>
        {skelHeader}
        <div className="ov-th-ret-hero">
          <MetricValue size="lg">00%</MetricValue>
          <span className="ov-th-ret-count">0 of 0 tracked lifts on track</span>
        </div>
        <div className="ov-th-bar" aria-hidden>
          {Array.from({ length: 15 }).map((_, i) => (
            <span key={i} className="ov-th-bar-seg is-good" />
          ))}
        </div>
        <div className="ov-th-fold">
          <span className="ov-th-fold-left">
            <span className="ov-th-fold-text ov-th-fold-text--muted">Loading…</span>
          </span>
        </div>
      </>
    );
    return variant === "snapshot" ? (
      <button
        type="button"
        className="page-card ov-training-health ov-training-health--nav loading-card"
        onClick={onNav}
      >
        {skelBody}
      </button>
    ) : (
      <div id={id} className="page-card ov-training-health loading-card">
        {skelBody}
      </div>
    );
  }

  const hasData = strength.total > 0;
  const attention = strength.attention;
  // Now is read once per render for the staleness labels. Fine as a plain read —
  // it only drives a "logged Nw ago" hint, nothing that needs to be reactive.
  const nowMs = Date.now();
  // The snapshot's one summary line, chosen by importance (see snapshotHighlight).
  const highlight = snapshotHighlight(strength.exercises, attention, nowMs);

  // Expanding On Track drops rows below the fold, where the floating tabbar can
  // clip them — nudge the section into view once the rows have rendered.
  const toggleHolding = () =>
    setTrackOpen((v) => {
      const next = !v;
      if (next) {
        requestAnimationFrame(() =>
          trackSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
        );
      }
      return next;
    });

  // Categorise every lift into ONE of: warning (acute ↓ decline, then chronic ●
  // plateau), reward (fresh PR, then rebounding), or holding-peak (no signal).
  // Only warnings + rewards get rows; holding-peak collapses to a count. Sorted
  // worst-first within each group (lowest retention reads first).
  const byRetention = (a: StrengthExercise, b: StrengthExercise) =>
    exerciseRetention(a) - exerciseRetention(b);
  const isFreshPR = (e: StrengthExercise) => weeksAgo(e.lastPRDate, nowMs) < 1 && !e.declining;

  const declining = strength.exercises.filter((e) => e.declining).sort(byRetention);
  const plateau = strength.exercises
    .filter((e) => e.needsAttention && !e.declining)
    .sort(byRetention);
  const warnings = [...declining, ...plateau];

  const freshPRs = strength.exercises.filter(isFreshPR).sort(byRetention);
  const rebounding = strength.exercises
    .filter((e) => e.recovering && !isFreshPR(e))
    .sort(byRetention);
  const rewards = [...freshPRs, ...rebounding];

  const signalSlugs = new Set([...warnings, ...rewards].map((e) => e.slug));
  const holdingPeak = strength.exercises.filter((e) => !signalSlugs.has(e.slug));
  const onTrackCount = strength.total - warnings.length;

  // Hero, colour, and count all derive from ONE source — strength.exercises.
  // Hero = mean % of PR across every qualifying lift; the count and bar report
  // how many of that same set are holding. No second dataset, so the big number
  // can never disagree with the line beneath it.
  const retentionPct = strength.exercises.length
    ? Math.round(
        (strength.exercises.reduce((s, e) => s + exerciseRetention(e), 0) /
          strength.exercises.length) *
          100,
      )
    : null;

  const emptyMsg = "No recent records to analyze yet";
  if (!hasData) {
    return variant === "snapshot" ? (
      <button
        type="button"
        className="page-card ov-training-health ov-training-health--nav"
        onClick={onNav}
      >
        <span className="ov-th-label">Training Health</span>
        <p className="ov-th-empty">{emptyMsg}</p>
      </button>
    ) : (
      <div id={id} className="page-card ov-training-health">
        <span className="ov-th-label">Training Health</span>
        <p className="ov-th-empty">{emptyMsg}</p>
      </div>
    );
  }

  const header = (
    <div className="ov-th-top">
      <span className="ov-th-label">Training Health</span>
      {variant === "snapshot" && <span className="ov-th-chevron" aria-hidden>›</span>}
    </div>
  );

  const hero = (
    <div className="ov-th-ret-hero">
      {/* Neutral ink — a big metric value never carries a verdict colour
          (colour lives on the delta/bar/badge, not the hero number). The
          on-track/attention verdict is already owned by the segmented bar +
          "N of M lifts" count below, so colouring the % too would double-
          encode it (invariant I3). */}
      <MetricValue size="lg">
        {retentionPct !== null ? <RetentionPct target={retentionPct} /> : "—"}
      </MetricValue>
      {/* "tracked" qualifies M — only lifts with enough history (4+ logged
          sessions) are judged. Absence of data isn't counted as anything, so
          the denominator is "lifts we can read," not "all your lifts." */}
      <span className="ov-th-ret-count">
        {onTrackCount} of {strength.total} tracked lifts on track
      </span>
    </div>
  );

  const bar = (
    <div
      className="ov-th-bar"
      role="img"
      aria-label={`${onTrackCount} of ${strength.total} tracked lifts on track`}
    >
      {strength.exercises.map((ex, i) => (
        <span
          key={ex.slug}
          // Each cell is coloured by its lift's state so the bar maps to the rows
          // below: acute decline = red tint, chronic plateau = amber, else green.
          className={`ov-th-bar-seg${ex.declining ? " is-declining" : ex.needsAttention ? " is-watch" : " is-good"}`}
          // Cells snap in one at a time on a fixed --stagger-step tick (NOT divided
          // by count) so the one-by-one rhythm stays legible — a discrete cascade.
          style={{ animationDelay: `calc(var(--enter-wait) + ${i} * var(--stagger-step))` }}
        />
      ))}
    </div>
  );

  // ── Snapshot (Overview): whole card navigates to Training; one summary line
  //    stands in for the detail list, no fold/expand. ──
  if (variant === "snapshot") {
    return (
      <button
        type="button"
        className="page-card ov-training-health ov-training-health--nav"
        onClick={onNav}
      >
        {header}
        {hero}
        {bar}
        <div className="ov-th-fold">
          <span className="ov-th-fold-left">
            {highlight.kind === "declining" && (
              <>
                <span className="ov-th-fold-marker" aria-hidden>↓</span>
                <span className="ov-th-fold-text">{highlight.name} declining</span>
              </>
            )}
            {highlight.kind === "pr" && (
              <>
                <span className="ov-th-fold-emoji" aria-hidden>🔥</span>
                <span className="ov-th-fold-text">
                  {highlight.count === 1
                    ? "New PR this week"
                    : `${highlight.count} new PRs this week`}
                </span>
              </>
            )}
            {highlight.kind === "clear" && (
              <span className="ov-th-fold-text">All tracked lifts on track</span>
            )}
            {highlight.kind === "attention" && (
              <>
                <span className="ov-th-fold-chip">{highlight.count}</span>
                <span className="ov-th-fold-text">need attention</span>
              </>
            )}
          </span>
        </div>
      </button>
    );
  }

  // ── Full (Training tab): the complete list, always shown. No "+more" nav —
  //    you're already in Training. ──
  return (
    <div id={id} className="page-card ov-training-health">
      {header}
      {hero}
      {bar}
      <div className="ov-th-fold-body">
        {warnings.length > 0 && (
          <div className="ov-th-section">
            <div className="ov-th-sect-head-row ov-th-sect-head-row--static">
              <span className="ov-th-sect-head">Needs attention · {warnings.length}</span>
            </div>
            {warnings.map((ex) => (
              <WarningRow key={ex.slug} exercise={ex} onJump={onJumpToExercise} />
            ))}
          </div>
        )}
        {rewards.length > 0 && (
          <div className="ov-th-section">
            <div className="ov-th-sect-head-row ov-th-sect-head-row--static">
              <span className="ov-th-sect-head">Wins</span>
            </div>
            {freshPRs.map((ex) => (
              <RewardRow key={ex.slug} exercise={ex} rewardKind="pr" onJump={onJumpToExercise} />
            ))}
            {rebounding.map((ex) => (
              <RewardRow key={ex.slug} exercise={ex} rewardKind="rebounding" onJump={onJumpToExercise} />
            ))}
          </div>
        )}
        {holdingPeak.length > 0 && (
          <div className="ov-th-section" ref={trackSectionRef}>
            <HoldingPeak exercises={holdingPeak} open={trackOpen} onToggle={toggleHolding} />
          </div>
        )}
      </div>
    </div>
  );
}
