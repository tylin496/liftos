import { MetricValue } from "@shared/components/Metric";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import type { StrengthSummary, StrengthExercise, CompoundProgress } from "../overview/api";
import "./strengthHealthCard.css";

// On-track rows show "% of all-time PR" (how close to your best). Flagged
// (watch) rows instead carry a stalled readout counting whole weeks since
// the last new best — that's what actually earned the flag, and it reads
// clearer than a % that could look like a contradiction (e.g. "97% · Review").
function exerciseRetention(ex: StrengthExercise): number {
  return ex.latestE1RM / ex.prE1RM;
}

function fmtStalledReadout(weeks: number): { value: string; label: string } {
  if (weeks < 1) return { value: "PR", label: "this wk" };
  return { value: `${weeks}`, label: weeks === 1 ? "wk stalled" : "wks stalled" };
}

function AttentionRow({ exercise }: { exercise: StrengthExercise }) {
  const stalled = fmtStalledReadout(exercise.stalledWeeks);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-dot" aria-hidden />
      <span className="ov-th-row-name">{exercise.name}</span>
      <span className="ov-th-row-stalled">
        <span className="ov-th-row-stalled-val">{stalled.value}</span>{" "}
        <span className="ov-th-row-stalled-label">{stalled.label}</span>
      </span>
    </div>
  );
}

function OnTrackRow({ exercise }: { exercise: StrengthExercise }) {
  const retPct = Math.round(exerciseRetention(exercise) * 100);
  return (
    <div className="ov-th-row">
      <span className="ov-th-row-name">{exercise.name}</span>
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
  compoundProgress: CompoundProgress | null;
  /** "snapshot" = Overview (hero + bar + one summary line, taps to Training).
   *  "full" = Training tab (same header, detail lists shown inline). */
  variant: "snapshot" | "full";
  /** Only meaningful for the snapshot — taps navigate to Training. */
  onNav?: () => void;
}

export function StrengthHealthCard({
  strength,
  compoundProgress,
  variant,
  onNav,
}: StrengthHealthCardProps) {
  const hasData = strength.total > 0;
  const retentionPct = compoundProgress ? Math.round(compoundProgress.overall * 100) : null;
  const attention = strength.watch;

  // Attention always sits above On Track and is ordered worst-first (steepest
  // recent decline, i.e. lowest trend), so the most urgent exercise reads first.
  const watchExercises = strength.exercises
    .filter((e) => e.status === "watch")
    .sort((a, b) => a.trend - b.trend);
  // On Track is ordered worst-first (lowest % of PR), so the exercises
  // closest to needing attention read first.
  const onTrackExercises = strength.exercises
    .filter((e) => e.status !== "watch")
    .sort((a, b) => exerciseRetention(a) - exerciseRetention(b));

  const emptyMsg = "Log 4+ sessions per exercise to unlock training health";
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
      <div className="page-card ov-training-health">
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
      <span className="ov-th-ret-count">
        {onTrackExercises.length} of {strength.total} lifts on track
      </span>
    </div>
  );

  const bar = (
    <div
      className="ov-th-bar"
      role="img"
      aria-label={`${onTrackExercises.length} of ${strength.total} lifts on track`}
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
    <div className="page-card ov-training-health">
      {header}
      {hero}
      {bar}
      <div className="ov-th-fold-body">
        {watchExercises.length > 0 && (
          <div className="ov-th-section">
            <div className="ov-th-sect-head-row">
              <span className="ov-th-sect-head">Needs attention · {watchExercises.length}</span>
            </div>
            {watchExercises.map((ex) => (
              <AttentionRow key={ex.slug} exercise={ex} />
            ))}
          </div>
        )}
        {onTrackExercises.length > 0 && (
          <div className="ov-th-section">
            <div className="ov-th-sect-head-row">
              <span className="ov-th-sect-head">On track · {onTrackExercises.length}</span>
            </div>
            {onTrackExercises.map((ex) => (
              <OnTrackRow key={ex.slug} exercise={ex} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
