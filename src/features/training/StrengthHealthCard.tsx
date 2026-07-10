import { useState } from "react";
import { MetricValue } from "@shared/components/Metric";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import type { StrengthSummary, StrengthExercise } from "../overview/api";
import type { MuscleGroup } from "./muscleGroup";
import { buildMuscleGrid, liftStatus, STATUS_ICON, steadyNote } from "./muscleGrid";
import type { LiftStatus } from "./muscleGrid";
import { suggestDeload } from "./deload";
import "./strengthHealthCard.css";

// ── Semantics (the whole point of the redesign) ──────────────────────────────
// % = RETENTION (current ÷ best), always neutral white, mono, tabular. Never
// tinted by status. COLOUR = STATUS, and lives only in outlines, tints, status
// icons, per-lift marks, and sparkline strokes. The two never mix.

function retentionPct(ex: StrengthExercise): number {
  return Math.round((ex.prE1RM > 0 ? ex.latestE1RM / ex.prE1RM : 0) * 100);
}

// ── Trend chip: overall health-% delta vs ~1 month ago ───────────────────────
// Computed upstream in strength.ts (a re-run of the summary on month-old logs).
// A flat move (<1 point) shows no chip — noise shouldn't read as a trend.
function TrendChip({ trend }: { trend: NonNullable<StrengthSummary["healthTrend"]> }) {
  if (trend.dir === "flat") return null;
  const up = trend.dir === "up";
  return (
    <span className={`ov-th-trend ov-th-trend--${up ? "up" : "down"}`}>
      {up ? "↑" : "↓"}
      {trend.delta}%
    </span>
  );
}

/** Subline suffix — the trend restated in words. Omitted when flat/absent. */
function trendSuffix(trend: StrengthSummary["healthTrend"]): string {
  if (!trend || trend.dir === "flat") return "";
  return trend.dir === "up" ? " · improving this month" : " · slipping this month";
}

// A drill-down row's mini trend line — last ≤6 session bests, coloured by the
// lift's status via currentColor (set by the status-* class), so the stroke
// stays on the one status language. Nodes stay round (explicit width/height).
function Sparkline({ bests, status }: { bests: number[]; status: LiftStatus }) {
  const pts = bests.slice(-6);
  if (pts.length < 2) return <span className="ov-thg-spark ov-thg-spark--empty" aria-hidden />;
  const W = 72, H = 24, PAD = 3;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const stepX = (W - PAD * 2) / (pts.length - 1);
  const coords = pts.map((v, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = coords[coords.length - 1].split(",");
  return (
    <svg className={`ov-thg-spark status-${status}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.6" fill="currentColor" />
    </svg>
  );
}

/** The per-lift note in a drill-down row: status glyph + the one next step
 *  (deload target for flagged lifts, a short state note otherwise). */
function drillNote(ex: StrengthExercise, status: LiftStatus): string {
  const icon = STATUS_ICON[status];
  switch (status) {
    case "declining": {
      const s = suggestDeload(ex);
      return s?.targetKg != null ? `${icon} declining — ease to ~${s.targetKg} kg` : `${icon} declining last 3 sessions`;
    }
    case "stalled": {
      const s = suggestDeload(ex);
      const wk = `${ex.stalledWeeks} ${ex.stalledWeeks === 1 ? "wk" : "wks"}`;
      return s?.targetKg != null ? `${icon} stalled ${wk} — drop to ~${s.targetKg} kg` : `${icon} stalled ${wk}`;
    }
    case "pr":
      return `${icon} new PR this week`;
    case "rebounding":
      return `${icon} rebounding — climbing back`;
    default:
      return `${icon} ${steadyNote(ex)}`;
  }
}

// Legend row — icon + word pairs. The 4-colour dot legend is replaced by glyphs.
const LEGEND: { status: LiftStatus; word: string }[] = [
  { status: "declining", word: "declining" },
  { status: "stalled", word: "stalled" },
  { status: "pr", word: "PR" },
  { status: "rebounding", word: "rebounding" },
  { status: "steady", word: "steady" },
];

const ChevronRight = ({ className }: { className?: string }) => (
  <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
  /** "snapshot" = Overview (hero + bar + one worst-signal row, taps to Training).
   *  "full" = Training tab (muscle grid + legend + drill-down). */
  variant: "snapshot" | "full";
  /** Only meaningful for the snapshot — taps navigate to Training. */
  onNav?: () => void;
  /** Only meaningful for the full card — lets Overview's nav scroll straight
   *  to it (NavContext's scrollTo target) instead of landing at the tab top. */
  id?: string;
  /** Cold-load: render the same DOM with placeholder values + shimmer. */
  loading?: boolean;
  /** Full variant only — tapping a drill-down lift row jumps to its card in the
   *  list and opens its Trend. Absent = rows aren't tappable. */
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
  // Selected muscle group for the drill-down. Uncontrolled default = worst group
  // (grid[0]); this holds a user's explicit pick, falling back to the worst group
  // whenever it's unset or the picked group has dropped out of the data.
  const [picked, setPicked] = useState<MuscleGroup | null>(null);

  // In-place skeleton: same header + hero + bar structure with placeholder
  // values, tag kept stable per variant (button/div) so the node isn't replaced
  // when data lands.
  if (loading || !strength) {
    const skelHeader = (
      <div className="ov-th-top">
        <span className="ov-th-label">Training Health</span>
        {variant === "snapshot" && <ChevronRight className="ov-th-chevron" />}
      </div>
    );
    const skelBody = (
      <>
        {skelHeader}
        <div className="ov-th-ret-hero">
          <MetricValue size={variant === "snapshot" ? "xl" : "lg"}>00%</MetricValue>
          <span className="ov-th-ret-count">0 of 0 tracked lifts on track</span>
        </div>
        <div className="ov-th-bar" aria-hidden>
          {Array.from({ length: 11 }).map((_, i) => (
            <span key={i} className="ov-th-bar-seg is-good" />
          ))}
        </div>
      </>
    );
    return variant === "snapshot" ? (
      <button type="button" className="page-card ov-training-health ov-training-health--nav loading-card" onClick={onNav}>
        {skelBody}
      </button>
    ) : (
      <div id={id} className="page-card ov-training-health loading-card">
        {skelBody}
      </div>
    );
  }

  const hasData = strength.total > 0;
  const emptyMsg = "No lifts tracked yet — log a few sessions to see this";
  if (!hasData) {
    return variant === "snapshot" ? (
      <button type="button" className="page-card ov-training-health ov-training-health--nav" onClick={onNav}>
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

  // Now is read once per render for the fresh-PR window. Fine as a plain read.
  const nowMs = Date.now();
  const grid = buildMuscleGrid(strength.exercises, nowMs);
  // On track = lifts NOT flagged for intervention (strength.attention is exactly
  // the declining ∪ stalled count). Hero % + trend come from the summary so the
  // number never re-derives independently of the export/engine.
  const onTrack = strength.total - strength.attention;
  const heroPct = strength.healthPct;
  const trend = strength.healthTrend;

  const header = (variant === "snapshot" ? (
    <div className="ov-th-top">
      <span className="ov-th-label">Training Health</span>
      <ChevronRight className="ov-th-chevron" />
    </div>
  ) : (
    <div className="ov-th-top">
      <span className="ov-th-label">Training Health</span>
    </div>
  ));

  const hero = (
    <div className="ov-th-ret-hero">
      <span className="ov-th-hero-row">
        {/* Neutral ink — a big metric value never carries a verdict colour.
            The verdict lives on the trend chip + bar + count, not the %. */}
        <MetricValue size={variant === "snapshot" ? "xl" : "lg"}>
          {heroPct !== null ? <RetentionPct target={heroPct} /> : "—"}
        </MetricValue>
        {trend && <TrendChip trend={trend} />}
      </span>
      {/* "tracked" qualifies the denominator — only lifts with enough history
          (≥4 sessions) are judged. */}
      <span className="ov-th-ret-count">
        {onTrack} of {strength.total} tracked lifts on track{trendSuffix(trend)}
      </span>
    </div>
  );

  // Bar cells are severity-sorted (good → stalled → declining) so the on-track
  // green fills from the left and flagged lifts collect at the right — one clean
  // proportion meter. Its cell-by-cell entrance is a sanctioned cascade.
  const barSeverity = (e: StrengthExercise) => (e.declining ? 2 : e.needsAttention ? 1 : 0);
  const barCells = [...strength.exercises].sort((a, b) => barSeverity(a) - barSeverity(b));
  const bar = (
    <div className="ov-th-bar" role="img" aria-label={`${onTrack} of ${strength.total} tracked lifts on track`}>
      {barCells.map((ex, i) => (
        <span
          key={ex.slug}
          className={`ov-th-bar-seg${ex.declining ? " is-declining" : ex.needsAttention ? " is-watch" : " is-good"}`}
          style={{ animationDelay: `calc(var(--enter-wait) + ${i} * var(--stagger-step))` }}
        />
      ))}
    </div>
  );

  // ── Snapshot (Overview): whole card navigates to Training; one worst-signal
  //    row is the hook into Detail. Hidden when nothing is declining/stalled. ──
  if (variant === "snapshot") {
    const worst = grid[0];
    const showSignal = worst && (worst.status === "declining" || worst.status === "stalled");
    const signalLift = showSignal ? worst.lifts[0] : null;
    const signalDetail = signalLift
      ? worst.status === "declining"
        ? `${signalLift.name} declining · 3 sessions`
        : `${signalLift.name} stalled · ${signalLift.stalledWeeks} ${signalLift.stalledWeeks === 1 ? "wk" : "wks"}`
      : "";
    return (
      <button type="button" className="page-card ov-training-health ov-training-health--nav" onClick={onNav}>
        {header}
        {hero}
        {bar}
        {showSignal && signalLift && (
          <div className={`ov-th-signal tone-${worst.tone}`}>
            <span className={`ov-th-signal-icon status-${worst.status}`} aria-hidden>{STATUS_ICON[worst.status]}</span>
            <span className="ov-th-signal-group">{worst.group}</span>
            <span className="ov-th-signal-detail">{signalDetail}</span>
            <ChevronRight className="ov-th-signal-chev" />
          </div>
        )}
      </button>
    );
  }

  // ── Full (Training tab): muscle grid + legend + drill-down. ──
  const selectedGroup =
    picked != null && grid.some((c) => c.group === picked) ? picked : grid[0]?.group ?? null;
  const selectedCell = grid.find((c) => c.group === selectedGroup) ?? null;

  return (
    <div id={id} className="page-card ov-training-health">
      {header}
      {hero}
      {bar}

      <div className="ov-thg-grid">
        {grid.map((cell) => (
          <button
            key={cell.group}
            type="button"
            className={`ov-thg-cell tone-${cell.tone} size-${cell.sizeTier}${cell.hero ? " is-hero" : ""}${cell.group === selectedGroup ? " is-selected" : ""}`}
            onClick={() => setPicked(cell.group)}
          >
            <span className="ov-thg-cell-head">
              <span className="ov-thg-cell-name">{cell.group}</span>
              <span className="ov-thg-cell-metric">
                <span className={`ov-thg-cell-icon status-${cell.status}`} aria-hidden>{STATUS_ICON[cell.status]}</span>
                <span className="ov-thg-cell-pct">{cell.pct}%</span>
              </span>
            </span>
            <span className="ov-thg-cell-insight">{cell.insight}</span>
            <span className="ov-thg-cell-foot">
              <span className="ov-thg-marks">
                {cell.marks.map((m) => (
                  <span key={m.slug} className={`ov-thg-mark status-${m.status}`} aria-hidden>{m.icon}</span>
                ))}
              </span>
              <span className="ov-thg-cell-count">{cell.count}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="ov-thg-legend">
        {LEGEND.map((l) => (
          <span key={l.status} className="ov-thg-leg">
            <span className={`ov-thg-leg-icon status-${l.status}`} aria-hidden>{STATUS_ICON[l.status]}</span>
            <span className="ov-thg-leg-word">{l.word}</span>
          </span>
        ))}
      </div>

      {selectedCell && (
        <div className="ov-thg-drill">
          <div className="ov-thg-drill-head">
            <span className="ov-thg-drill-title">{selectedCell.group}</span>
            <span className="ov-thg-drill-count">{selectedCell.count}</span>
          </div>
          {selectedCell.lifts.map((ex) => {
            const st = liftStatus(ex, nowMs);
            const row = (
              <>
                <Sparkline bests={ex.recentBests} status={st} />
                <span className="ov-thg-drill-lift">
                  <span className="ov-thg-drill-name">{ex.name}</span>
                  <span className={`ov-thg-drill-note status-${st}`}>{drillNote(ex, st)}</span>
                </span>
                <span className="ov-thg-drill-pct">{retentionPct(ex)}%</span>
              </>
            );
            return onJumpToExercise ? (
              <button key={ex.slug} type="button" className="ov-thg-drill-row ov-thg-drill-row--tap" onClick={() => onJumpToExercise(ex.slug)}>
                {row}
              </button>
            ) : (
              <div key={ex.slug} className="ov-thg-drill-row">{row}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
