import { useState } from "react";
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

function StaleHint({ isoDate, nowMs }: { isoDate: string; nowMs: number }) {
  const w = weeksAgo(isoDate, nowMs);
  if (w < STALE_WEEKS) return null;
  return <span className="ov-th-row-stale">· logged {w}w ago</span>;
}

function fmtStalledReadout(weeks: number): { value: string; label: string } {
  if (weeks < 1) return { value: "PR", label: "this wk" };
  // Neutral "weeks since PR" — not "stalled". A gap since the last PR is just a
  // fact, not a verdict; maintenance days go unlogged, so weeks-since-PR doesn't
  // mean weeks of no training.
  return { value: `${weeks}`, label: weeks === 1 ? "wk since PR" : "wks since PR" };
}

function AttentionRow({ exercise, nowMs }: { exercise: StrengthExercise; nowMs: number }) {
  const stalled = fmtStalledReadout(exercise.stalledWeeks);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-dot" aria-hidden />
      <span className="ov-th-row-name">{exercise.name}</span>
      <StaleHint isoDate={exercise.lastLogDate} nowMs={nowMs} />
      <span className="ov-th-row-stalled">
        <span className="ov-th-row-stalled-val">{stalled.value}</span>{" "}
        <span className="ov-th-row-stalled-label">{stalled.label}</span>
      </span>
    </div>
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

function OnTrackRow({ exercise, nowMs }: { exercise: StrengthExercise; nowMs: number }) {
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-name">{exercise.name}</span>
      <StaleHint isoDate={exercise.lastLogDate} nowMs={nowMs} />
      <span className="ov-th-row-pct">{retPct}%</span>
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
  strength: StrengthSummary;
  /** "snapshot" = Overview (hero + bar + one summary line, taps to Training).
   *  "full" = Training tab (same header, detail lists shown inline). */
  variant: "snapshot" | "full";
  /** Only meaningful for the snapshot — taps navigate to Training. */
  onNav?: () => void;
  /** Only meaningful for the full card — lets Overview's nav scroll straight
   *  to it (NavContext's scrollTo target) instead of landing at the tab top. */
  id?: string;
}

export function StrengthHealthCard({
  strength,
  variant,
  onNav,
  id,
}: StrengthHealthCardProps) {
  const hasData = strength.total > 0;
  const attention = strength.watch;
  // Now is read once per render for the staleness labels. Fine as a plain read —
  // it only drives a "logged Nw ago" hint, nothing that needs to be reactive.
  const nowMs = Date.now();
  // Both sections default collapsed — the full card opens as just the hero +
  // bar (a status read), and the row-by-row detail is opt-in per section.
  const [watchOpen, setWatchOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);

  // Attention always sits above On Track and is ordered worst-first (furthest
  // below PR, i.e. lowest retention), so the most urgent exercise reads first.
  const watchExercises = strength.exercises
    .filter((e) => e.status === "watch")
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));
  // On Track is ordered worst-first (lowest % of PR), so the exercises
  // closest to needing attention read first.
  const onTrackExercises = strength.exercises
    .filter((e) => e.status !== "watch")
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
      {/* Hero % that HAS a progress bar → takes a semantic verdict colour: gold
          if any lift needs attention, else green. Neutral only when there's no
          data ("—"). */}
      <MetricValue
        size="lg"
        style={retentionPct === null ? undefined : { color: attention > 0 ? "var(--gold)" : "var(--good)" }}
      >
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
          className={`ov-th-bar-seg${i < onTrackExercises.length ? " is-good" : ""}`}
          // Exception to the flat entrance: segments still fill one-by-one, but
          // the whole run is spread across --dur-enter (after --enter-wait) so it
          // stays inside the 500ms budget regardless of segment count.
          style={{ animationDelay: `calc(var(--enter-wait) + ${i} * var(--dur-enter) / ${Math.max(1, strength.exercises.length)})` }}
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
            {attention > 0 && (
              <>
                <span className="ov-th-fold-chip">{attention}</span>
                <span className="ov-th-fold-text">need attention</span>
                <span className="ov-th-fold-sep" aria-hidden>·</span>
              </>
            )}
            <span className="ov-th-fold-text ov-th-fold-text--muted">
              {onTrackExercises.length} on track
            </span>
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
            <SectHeadRow
              label={`Needs attention · ${watchExercises.length}`}
              open={watchOpen}
              onToggle={() => setWatchOpen((v) => !v)}
            />
            {watchOpen &&
              watchExercises.map((ex) => (
                <AttentionRow key={ex.slug} exercise={ex} nowMs={nowMs} />
              ))}
          </div>
        )}
        {onTrackExercises.length > 0 && (
          <div className="ov-th-section">
            <SectHeadRow
              label={`On track · ${onTrackExercises.length}`}
              open={trackOpen}
              onToggle={() => setTrackOpen((v) => !v)}
            />
            {trackOpen &&
              onTrackExercises.map((ex) => (
                <OnTrackRow key={ex.slug} exercise={ex} nowMs={nowMs} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
