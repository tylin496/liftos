import { useState } from "react";
import { MetricValue } from "@shared/components/Metric";
import { useBottomUpDelay } from "@shared/hooks/useBottomUpDelay";
import { useCountUp, COUNT_UP_MS } from "@shared/hooks/useCountUp";
import type { StrengthSummary, StrengthExercise } from "../overview/api";
import { inferMuscleGroup, type MuscleGroup } from "./muscleGroup";
import { buildMuscleGrid, cellBody, liftStatus, MARK_WORD, STATUS_ICON, statusWord, steadyNote } from "./muscleGrid";
import type { LiftStatus, MuscleGridCell } from "./muscleGrid";
import { computeMuscleClusters, suggestClusterFatigue, type ClusterFatigueAdvice } from "./muscleCluster";
import { suggestDeload } from "./deload";
import { MuscleIcon } from "./MuscleIcon";
import { StatusGlyph } from "./StatusGlyph";
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
      {up ? "▲" : "▼"}
      {trend.delta}%
    </span>
  );
}

/** Subline suffix — the trend restated in words. Omitted when flat/absent. */
function trendSuffix(trend: StrengthSummary["healthTrend"]): string {
  if (!trend || trend.dir === "flat") return "";
  return trend.dir === "up" ? " improving this month" : " slipping this month";
}

/** Hero-cell footer — the marks row spelled out in words ("1 stalled · 1
 *  rebounding"). Bare glyphs (● ▲) are fine as texture on small tiles, but the
 *  spotlight is the first thing a new reader parses, so it must be legible
 *  without the colour code. Statuses listed worst-first (marks are already
 *  severity-sorted); steady is skipped unless it's ALL there is (an all-steady
 *  group reads "N steady", not an empty footer). */
function heroMarksSummary(marks: { status: LiftStatus }[]): string {
  const counts = new Map<LiftStatus, number>();
  for (const m of marks) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
  const parts: string[] = [];
  for (const [status, n] of counts) {
    if (status === "steady" && counts.size > 1) continue;
    parts.push(status === "pr" ? `${n} ${n === 1 ? "PR" : "PRs"}` : `${n} ${MARK_WORD[status]}`);
  }
  return parts.join(" ");
}

/** Hero-cell insight — a KPI-card summary ("Worst lift: RDL stalled"), not the
 *  full deload action. The spotlight's job is "what's happening", not "what
 *  do I do" — that action detail already lives one tap away in the drill-down
 *  (see drillLines). Duplicating it here made the hero read like the Summary
 *  pasted in early. Steady falls back to the grid's own insight (already
 *  short — "Near your best" etc. needs no further trimming). */
function heroInsight(cell: MuscleGridCell): string {
  const worst = cell.lifts[0];
  switch (cell.status) {
    case "declining":
      return `Worst lift: ${worst.name} declining`;
    case "stalled":
      // "below peak", not "stalled": with windowed retention this status means
      // "the recent sessions haven't come back to the all-time best", not
      // "today's set dropped" — say the state, not a verdict on one session.
      return `Worst lift: ${worst.name} below peak`;
    case "pr":
      return `${worst.name} — new PR this week`;
    case "rebounding":
      return `${worst.name} climbing back`;
    default:
      return cell.insight;
  }
}

/** Snapshot flagged-row detail line — same "one next step" language as
 *  `drillNote`, minus its leading icon (the row already carries a dot). */
function flaggedDetail(ex: StrengthExercise, status: "declining" | "stalled"): string {
  const s = suggestDeload(ex);
  if (status === "declining") {
    return s?.targetKg != null ? `declining — ease to ~${s.targetKg} kg` : "declining last 3 sessions";
  }
  const wk = `${ex.stalledWeeks} ${ex.stalledWeeks === 1 ? "wk" : "wks"}`;
  return s?.targetKg != null ? `stalled ${wk} — drop to ~${s.targetKg} kg` : `stalled ${wk}`;
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

/** Drill-down row lines, ACTION FIRST: this card is Health, not History — the
 *  reader's next question is "what do I do", so the deload cue leads and the
 *  status ("Stalled 43 wks") demotes to the line under it. Lifts with nothing
 *  to do (pr/rebounding/steady, or a flagged lift with no computable target)
 *  have no action line and keep their single status note. */
function drillLines(ex: StrengthExercise, status: LiftStatus): { action: string | null; state: string } {
  switch (status) {
    case "declining": {
      const s = suggestDeload(ex);
      return {
        action: s?.targetKg != null ? `Ease to ~${s.targetKg} kg` : null,
        state: "Declining last 3 sessions",
      };
    }
    case "stalled": {
      const s = suggestDeload(ex);
      const wk = `${ex.stalledWeeks} ${ex.stalledWeeks === 1 ? "wk" : "wks"}`;
      return {
        action: s?.targetKg != null ? `Drop to ~${s.targetKg} kg` : null,
        state: `Stalled ${wk}`,
      };
    }
    case "pr":
      return { action: null, state: "New PR this week" };
    case "rebounding":
      return { action: null, state: "Rebounding — climbing back" };
    default: {
      const n = steadyNote(ex);
      return { action: null, state: n[0].toUpperCase() + n.slice(1) };
    }
  }
}

// (Legend row removed — the status colour language is learnable from the tiles
// and drill rows themselves; a permanent legend cost a full row of height. If
// discoverability regresses, reintroduce as first-run onboarding, not chrome.)

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
  /** Override-aware muscle resolution (resolveMuscleBySlug) — lets a pinned
   *  `muscle_group_override` reach the grid + cluster reads. Absent (or a slug
   *  missing from the map) falls back to pure inference. */
  muscleBySlug?: Map<string, MuscleGroup>;
}

export function StrengthHealthCard({
  strength,
  variant,
  onNav,
  id,
  loading = false,
  onJumpToExercise,
  muscleBySlug,
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
    if (variant === "snapshot") {
      return (
        <button type="button" className="page-card ov-training-health ov-training-health--nav loading-card" onClick={onNav}>
          {skelHeader}
          <div className="ov-th-ret-hero">
            <span className="ov-th-hero-row">
              <MetricValue size="xl">00%</MetricValue>
            </span>
            <span className="ov-th-avg-retention">Avg retention</span>
          </div>
          <div className="ov-th-group-bar" aria-hidden>
            <span className="ov-th-group-seg is-good" style={{ flex: 1, borderRadius: "var(--radius-pill)" }} />
          </div>
        </button>
      );
    }
    return (
      <div id={id} className="page-card ov-training-health loading-card">
        {skelHeader}
        <div className="ov-th-ret-hero">
          <MetricValue size="lg">00%</MetricValue>
          <span className="ov-th-ret-count">0 of 0 tracked lifts on track</span>
        </div>
        <div className="ov-th-bar" aria-hidden>
          {Array.from({ length: 11 }).map((_, i) => (
            <span key={i} className="ov-th-bar-seg is-good" />
          ))}
        </div>
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
  // Same override-aware resolver for the grid AND the cluster read below —
  // undefined lets both fall back to their built-in inference default.
  const muscleOf = muscleBySlug
    ? (ex: StrengthExercise) => muscleBySlug.get(ex.slug) ?? inferMuscleGroup(ex.name, ex.slug)
    : undefined;
  const grid = buildMuscleGrid(strength.exercises, nowMs, muscleOf);
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

  // Full-variant header reads as ONE gauge, top to bottom: the % (with its
  // trend chip), the segmented bar it summarises, then the count line captioning
  // the bar — value → picture → words, no orphaned blocks between them.
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
      {/* Names the KPI — "88%" alone reads as "9 of 15 = 60%" to a first-time
          reader; this is retention (current ÷ best), not the on-track count
          the line below states. Same caption the snapshot variant already
          uses, just previously missing here. */}
      <span className="ov-th-avg-retention">Avg retention</span>
    </div>
  );
  // PR cadence — how many lifts set a PR in the trailing month (one per lift:
  // lastPRDate is each lift's most recent). The progression-velocity read a
  // retention % can't carry: retention says "near your best", this says "still
  // SETTING bests" — the number a bulk is run on. Full variant only; the
  // snapshot keeps its tighter this-week PR clause.
  const PR_CADENCE_DAYS = 30;
  const prCutoffMs = nowMs - PR_CADENCE_DAYS * 86400000;
  const recentPRCount = strength.exercises.filter(
    (e) => e.lastPRDate && new Date(e.lastPRDate + "T12:00:00").getTime() >= prCutoffMs,
  ).length;

  // "tracked" qualifies the denominator — only lifts with enough history
  // (≥4 sessions) are judged.
  const countLine = (
    <span className="ov-th-ret-count">
      {onTrack} of {strength.total} tracked lifts on track{trendSuffix(trend)}
      {variant === "full" && recentPRCount > 0 && (
        <span className="ov-th-pr-clause"> <span className="ov-th-pr-nowrap">🏆 {recentPRCount} PR{recentPRCount === 1 ? "" : "s"} in 30d</span></span>
      )}
    </span>
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

  // ── Snapshot (Overview): whole card navigates to Training. Every flagged
  //    lift gets its own named row (retention %, stalled/declining detail,
  //    deload cue) — nothing hides behind "worst only". Healthy lifts
  //    collapse to a one-line summary with PRs called out. ──
  if (variant === "snapshot") {
    // Declining (acute) sorts before stalled (chronic) — same worst-first
    // rule as the muscle grid's SEVERITY order.
    const flagged = strength.exercises
      .filter((ex) => ex.needsAttention)
      .sort((a, b) => Number(b.declining) - Number(a.declining));
    const steadyCount = strength.total - flagged.length;
    const prsThisWeek = strength.exercises.filter((ex) => liftStatus(ex, nowMs) === "pr").length;
    const prClause = prsThisWeek > 0 && (
      <span className="ov-th-pr-clause"> <span className="ov-th-pr-nowrap">🏆 {prsThisWeek} {prsThisWeek === 1 ? "PR" : "PRs"} this week</span></span>
    );

    return (
      <button type="button" className="page-card ov-training-health ov-training-health--nav" onClick={onNav}>
        {header}
        <div className="ov-th-ret-hero">
          <span className="ov-th-hero-row">
            <MetricValue size="xl">
              {heroPct !== null ? <RetentionPct target={heroPct} /> : "—"}
            </MetricValue>
            {trend && <TrendChip trend={trend} />}
          </span>
          <span className="ov-th-avg-retention">Avg retention</span>
          <span className="ov-th-ret-count">
            {onTrack} of {strength.total} tracked lifts on track{trendSuffix(trend)}
          </span>
        </div>

        {flagged.length > 0 && (
          <div className="ov-th-flagged-list">
            {flagged.map((ex) => {
              const status = ex.declining ? "declining" : "stalled";
              return (
                <div key={ex.slug} className="ov-th-flagged-row">
                  <span className={`ov-th-flagged-dot status-${status}`} aria-hidden>{STATUS_ICON[status]}</span>
                  <span className="ov-th-flagged-mid">
                    <span className="ov-th-flagged-name">{ex.name}</span>
                    <span className={`ov-th-flagged-detail status-${status}`}>{flaggedDetail(ex, status)}</span>
                  </span>
                  <span className="ov-th-flagged-pct">{retentionPct(ex)}%</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="ov-th-steady-summary">
          {flagged.length === 0 ? `All ${strength.total} lifts on track` : `– ${steadyCount} steady`}
          {prClause}
        </div>
      </button>
    );
  }

  // ── Full (Training tab): muscle grid + legend + drill-down. ──
  const selectedGroup =
    picked != null && grid.some((c) => c.group === picked) ? picked : grid[0]?.group ?? null;
  const selectedCell = grid.find((c) => c.group === selectedGroup) ?? null;

  // Systemic-fatigue overlay — the muscle-level read the per-lift grid can't
  // make: ≥2 lifts of one muscle declining within the same training block
  // (muscleCluster.ts). Flagged groups swap their tile insight for the systemic
  // verdict and gain a muscle-level action strip in the drill-down.
  const nameBySlug = new Map(strength.exercises.map((e) => [e.slug, e.name]));
  const fatigueByMuscle = new Map<MuscleGroup, ClusterFatigueAdvice>();
  for (const c of computeMuscleClusters(strength.exercises, muscleOf)) {
    const a = suggestClusterFatigue(c, (slug) => nameBySlug.get(slug) ?? slug);
    if (a) fatigueByMuscle.set(a.muscle, a);
  }
  // Tile body: the systemic verdict outranks the per-lift line — "several lifts
  // sliding together" is exactly what the composition/worst-lift text can't say.
  const cellInsight = (cell: MuscleGridCell): string => {
    const f = fatigueByMuscle.get(cell.group);
    if (!f) return cell.hero ? heroInsight(cell) : cellBody(cell);
    return cell.hero
      ? `${f.headline} — ${f.lifts.length} lifts sliding together`
      : `${f.lifts.length} lifts sliding together`;
  };
  const selectedFatigue = selectedGroup != null ? fatigueByMuscle.get(selectedGroup) : undefined;

  return (
    <div id={id} className="page-card ov-training-health">
      {header}
      {hero}
      {bar}
      {countLine}

      <div className="ov-thg-grid">
        {grid.map((cell) => (
          <button
            key={cell.group}
            type="button"
            className={`ov-thg-cell tone-${cell.tone}${cell.hero ? " is-hero" : ""}${cell.group === selectedGroup ? " is-selected" : ""}`}
            onClick={() => setPicked(cell.group)}
          >
            <span className="ov-thg-cell-head">
              <span className="ov-thg-cell-head-left">
                {cell.hero ? (
                  <span className={`ov-thg-hero-halo status-${cell.status}`}>
                    <MuscleIcon name={cell.group} size={36} />
                  </span>
                ) : (
                  <MuscleIcon name={cell.group} size={18} className="ov-thg-cell-muscle-icon" />
                )}
                <span className="ov-thg-cell-name">
                  {cell.group}
                  {/* Count rides the title, not a separate footer row — the
                      right side (status + %) is the only thing that should
                      carry weight there (handoff-review: left/right balance). */}
                  <span className="ov-thg-cell-name-count"> {cell.count}</span>
                </span>
              </span>
              <span className="ov-thg-cell-metric">
                {/* Hero keeps a headline % (its worst lift, the spotlight number)
                    beside the glyph; ordinary tiles are glyph-ONLY — the word
                    beside it kept truncating the muscle name on narrow screens,
                    and the glyph already carries the same status + colour (the
                    label keeps it screen-readable). */}
                {cell.hero ? (
                  <>
                    <StatusGlyph status={cell.status} size={15} className="ov-thg-cell-icon" />
                    <span className="ov-thg-cell-pct">{cell.pct}%</span>
                  </>
                ) : (
                  <StatusGlyph
                    status={cell.status}
                    size={14}
                    className="ov-thg-cell-icon"
                    label={statusWord(cell.status, cell.pct)}
                  />
                )}
              </span>
            </span>
            <span className="ov-thg-cell-insight">{cellInsight(cell)}</span>
            {/* Marks row is spotlight-only: an ordinary tile answers "how is this
                muscle" with name + status word + a body line (its composition, or
                the single lift's note). The hero adds the glyph-marks footer on
                top; ordinary tiles don't repeat it as a cryptic dot row. */}
            {cell.hero && (
              <span className="ov-thg-cell-foot">
                <span className="ov-thg-hero-marks-words">{heroMarksSummary(cell.marks)}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {selectedCell && (
        <div className="ov-thg-drill">
          <div className="ov-thg-drill-head">
            <span className="ov-thg-drill-title">{selectedCell.group}</span>
            <span className="ov-thg-drill-count">{selectedCell.count}</span>
          </div>
          {/* Muscle-level action — the decision layer above per-lift deload rows:
              when the muscle isn't recovering, the fix is its weekly volume, not
              −10% on one movement (suggestClusterFatigue). */}
          {selectedFatigue && (
            <div className="ov-thg-drill-fatigue">
              <span className="ov-thg-drill-fatigue-verdict status-declining">
                {selectedFatigue.headline} — {selectedFatigue.lifts.length} of {selectedFatigue.groupSize} lifts sliding together
              </span>
              <span className="ov-thg-drill-fatigue-step">{selectedFatigue.step}</span>
            </div>
          )}
          {selectedCell.lifts.map((ex) => {
            const st = liftStatus(ex, nowMs);
            const { action, state } = drillLines(ex, st);
            const row = (
              <>
                <Sparkline bests={ex.recentBests} status={st} />
                <span className="ov-thg-drill-lift">
                  <span className="ov-thg-drill-name">{ex.name}</span>
                  {action && <span className="ov-thg-drill-action">{action}</span>}
                  <span className={`ov-thg-drill-note status-${st}`}>{state}</span>
                  {/* Provenance: the concrete set behind the retention %, so the
                      drill-down adds the numbers instead of restating the tile. */}
                  {ex.lastPRDetail && <span className="ov-thg-drill-best">Best {ex.lastPRDetail}</span>}
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
