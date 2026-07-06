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

// Staleness is a LABEL, never a score adjustment. A lift last logged long ago
// just means "we don't know if this still represents now" — the app never
// guesses recovery or decline from silence (maintenance goes unlogged). Rows
// only surface the hint past this threshold so fresh lifts stay uncluttered.
const STALE_WEEKS = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weeksAgo(isoDate: string, nowMs: number): number {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((nowMs - t) / WEEK_MS);
}

// ── Snapshot summary line: a tiny decision engine, not a fixed readout ───────
// The Overview snapshot has one summary line, and Training Health should never
// open on only bad news. Line 2 already carries "N of M lifts on track", so
// this line is free to lead with the single best true thing to say today,
// chosen by importance:
//   1. a fresh PR this week  → the most rewarding signal; it wins even when
//      other lifts still need attention (that count is on the line above, so
//      it's never lost — we just don't headline with it)
//   2. everything on track   → nothing is flagged, so say so plainly
//   3. lifts need attention  → the honest fallback when there's no win to show
// Every branch is derivable from the snapshot alone. In particular we never
// infer "recovering" or "plateau broken" — those need prior state, and the app
// deliberately never guesses progress from unlogged maintenance (silence = no
// info), so surfacing them here would contradict the rest of the card.
type SnapshotHighlight =
  | { kind: "pr"; count: number }
  | { kind: "clear" }
  | { kind: "attention"; count: number };

function snapshotHighlight(
  exercises: StrengthExercise[],
  watch: number,
  nowMs: number,
): SnapshotHighlight {
  // Fresh PR = a PR on EITHER axis (new e1RM ceiling OR heaviest weight ever)
  // landed within the past week. lastPRDate is the two-axis stall clock's reset
  // point, so this counts Performance PRs — a heavier top set Epley rates flat
  // (77kg×7 ≈ 75kg×8) — not just new e1RM ceilings, and it survives a lighter
  // session logged after the PR. Honest from the snapshot, no history needed.
  const freshPRs = exercises.filter((e) => weeksAgo(e.lastPRDate, nowMs) < 1).length;
  if (freshPRs > 0) return { kind: "pr", count: freshPRs };
  if (watch === 0) return { kind: "clear" };
  return { kind: "attention", count: watch };
}

function StaleHint({ isoDate, nowMs }: { isoDate: string; nowMs: number }) {
  const w = weeksAgo(isoDate, nowMs);
  if (w < STALE_WEEKS) return null;
  return <span className="ov-th-row-stale">logged {w}w ago</span>;
}

// Bare number only — the "wks since PR" unit lives once in the section header
// (a column label), so rows stop repeating it four times over. A fresh PR
// (< 1 wk) is the one row that can't read as a week count, so it keeps a tiny
// inline word instead of a number.
function AttentionRow({
  exercise,
  nowMs,
  onJump,
}: {
  exercise: StrengthExercise;
  nowMs: number;
  onJump?: (slug: string) => void;
}) {
  const weeks = exercise.stalledWeeks;
  const body = (
    <>
      <span className="ov-th-row-dot" aria-hidden />
      <span className="ov-th-row-name">{exercise.name}</span>
      <StaleHint isoDate={exercise.lastLogDate} nowMs={nowMs} />
      {weeks < 1 ? (
        <span className="ov-th-row-fresh">PR this wk</span>
      ) : (
        <span className="ov-th-row-stalled-val">{weeks}</span>
      )}
    </>
  );
  return onJump ? (
    <button type="button" className="ov-th-row ov-th-row--tap" onClick={() => onJump(exercise.slug)}>
      {body}
    </button>
  ) : (
    <div className="ov-th-row">{body}</div>
  );
}

// Section header doubles as the fold trigger — defaults collapsed so the full
// card opens as just the hero + bar; the two lists are opt-in detail, not
// something you scroll past every time.
function SectHeadRow({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="ov-th-sect-head-row"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span className="ov-th-sect-head">{label}</span>
      <svg
        className={`ov-th-sect-chevron${open ? " open" : ""}`}
        width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
      >
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function OnTrackRow({
  exercise,
  nowMs,
  onJump,
}: {
  exercise: StrengthExercise;
  nowMs: number;
  onJump?: (slug: string) => void;
}) {
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  const body = (
    <>
      <span className="ov-th-row-name">{exercise.name}</span>
      {/* A watch lift climbing back lives here (not the red list); this note
          explains why a sub-94% row sits under On Track — it's on the way up. */}
      {exercise.recovering && <span className="ov-th-row-recover">↑ 回升中</span>}
      <StaleHint isoDate={exercise.lastLogDate} nowMs={nowMs} />
      <span className="ov-th-row-pct">{retPct}%</span>
    </>
  );
  return onJump ? (
    <button type="button" className="ov-th-row ov-th-row--tap" onClick={() => onJump(exercise.slug)}>
      {body}
    </button>
  ) : (
    <div className="ov-th-row">{body}</div>
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
  const toggleTrack = () =>
    setTrackOpen((v) => {
      const next = !v;
      if (next) {
        requestAnimationFrame(() =>
          trackSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
        );
      }
      return next;
    });

  // Attention always sits above On Track and is ordered worst-first (furthest
  // below PR, i.e. lowest retention), so the most urgent exercise reads first.
  // `needsAttention` (not raw `watch`) gates the list, so a lift that dipped below
  // PR but PR'd on either axis within the last few weeks stays out of the red.
  const watchExercises = strength.exercises
    .filter((e) => e.needsAttention)
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));
  // On Track is ordered worst-first (lowest % of PR), so the exercises
  // closest to needing attention read first.
  const onTrackExercises = strength.exercises
    .filter((e) => !e.needsAttention)
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));

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
        {onTrackExercises.length} of {strength.total} tracked lifts on track
      </span>
    </div>
  );

  const bar = (
    <div
      className="ov-th-bar"
      role="img"
      aria-label={`${onTrackExercises.length} of ${strength.total} tracked lifts on track`}
    >
      {strength.exercises.map((ex, i) => (
        <span
          key={ex.slug}
          className={`ov-th-bar-seg${i < onTrackExercises.length ? " is-good" : " is-watch"}`}
          // Green cells snap in one at a time on a fixed --stagger-step tick
          // (NOT divided by count) so the one-by-one rhythm stays legible — a
          // discrete cascade, intentionally past the flat-entrance budget.
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
        {watchExercises.length > 0 && (
          <div className="ov-th-section">
            <div className="ov-th-sect-head-row ov-th-sect-head-row--static">
              <span className="ov-th-sect-head">Needs attention · {watchExercises.length}</span>
              <span className="ov-th-sect-unit">wks since PR</span>
            </div>
            {watchExercises.map((ex) => (
              <AttentionRow key={ex.slug} exercise={ex} nowMs={nowMs} onJump={onJumpToExercise} />
            ))}
          </div>
        )}
        {onTrackExercises.length > 0 && (
          <div className="ov-th-section" ref={trackSectionRef}>
            <SectHeadRow
              label={`On track · ${onTrackExercises.length}`}
              open={trackOpen}
              onToggle={toggleTrack}
            />
            {trackOpen &&
              onTrackExercises.map((ex) => (
                <OnTrackRow key={ex.slug} exercise={ex} nowMs={nowMs} onJump={onJumpToExercise} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
