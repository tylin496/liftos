// Pure stat functions operating on TrainingLog[] from Supabase.

import type { TrainingLog } from "./api";
import { parse, score, type Parsed } from "./parser";

export type TimeFilter = "3mo" | "year" | "all";

/** How a lift is scored — the single switch the whole training pipeline reads so
 *  the card, the log-time toast, and the export never disagree. `compound` judges
 *  on estimated 1RM (heavy, low-rep = the goal); `isolation` judges on best-set
 *  tonnage (weight × reps), which stays flat when you trade load for reps — so a
 *  deliberate rep-target change (12→16) reads as maintained work, not a regression.
 *  Maps 1:1 off `exercises.compound`: `compound` ? "compound" : "isolation". */
export type ScoreMode = "compound" | "isolation";

export interface LogEntry {
  log: TrainingLog;
  weightKg: number;
  reps: string;
  e1rm: number;
  totalReps: number;
  /** Best-set tonnage: top-set weight × its reps (set-count-free, like e1rm).
   *  The isolation score axis — folds weight and reps into one hypertrophy number
   *  the way e1rm folds them into one strength number. */
  tonnage: number;
}

// ─── Time filter ─────────────────────────────────────────────────────────────

export function filterByTime(logs: TrainingLog[], filter: TimeFilter): TrainingLog[] {
  if (!filter || filter === "all") return logs;
  const now = new Date();
  // Both windows are trailing so the two filters stay consistent — "1Y" means
  // the last 365 days, not year-to-date (which showed almost nothing in Jan).
  const cutoff =
    filter === "year"
      ? new Date(now.getTime() - 365 * 86400000)
      : new Date(now.getTime() - 90 * 86400000);
  return logs.filter((l) => {
    if (!l.log_date) return false;
    const d = new Date(l.log_date + "T12:00:00");
    return d >= cutoff;
  });
}

// ─── e1RM (Epley) ────────────────────────────────────────────────────────────

/** Max reps across drop-set segments, e.g. "10/8/6" -> 10. */
export function maxReps(repsStr: string): number {
  const segs = String(repsStr || "")
    .split(/[/\-]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  return segs.length ? Math.max(...segs) : 0;
}

/**
 * Total reps actually performed. Drop-set segments ("8/5/3") sum as-is — each
 * segment is already one distinct set. A single number ("7") is the log
 * form's shorthand for the same rep count repeated across the exercise's
 * configured set count (see repsStringToValues in logFormHelpers.ts), so it
 * expands to `reps * setCount` — "7" on a ×3 exercise is 3 sets of 7 (21),
 * not one set of 7.
 */
export function totalReps(repsStr: string, setCount: number): number {
  const segs = String(repsStr || "")
    .split(/[/\-]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  if (!segs.length) return 0;
  if (segs.length === 1) return segs[0] * Math.max(1, setCount);
  return segs.reduce((sum, n) => sum + n, 0);
}

/** Reps past which Epley's linear term overestimates 1RM badly. Beyond this a
 *  high-rep burnout set would mint an unbeatable "PR" ceiling no normal working
 *  set can touch — real export: Leg Curl 68×15 → a phantom 102 e1RM vs a ~95
 *  working ceiling, leaving the lift permanently "stale / below PR" against a
 *  number it can't beat. Clamp the rep count into the formula so a set past 12
 *  estimates the same as 12 (where Epley is still trustworthy). Only affects
 *  sets logged above 12 reps; every normal working set is unchanged. */
const EPLEY_MAX_REPS = 12;

export function epley1RM(weightKg: number, repsStr: string): number {
  const maxR = Math.min(maxReps(repsStr), EPLEY_MAX_REPS);
  if (!maxR || !weightKg || weightKg <= 0) return 0;
  return weightKg * (1 + maxR / 30);
}

/** The weight fed into the score axes (e1RM / tonnage) — NOT the display kg.
 *  Normal logs: the absolute load, same as `score`. Assisted logs (the
 *  `bw-(assist)` form): the % of bodyweight actually lifted. On a cut the
 *  effective kg of an assisted pull-up falls purely because the body shrank
 *  (and a bulk would gift PRs), so judging those logs on absolute kg minted
 *  phantom declines — same pull at 10/10/10 read as "recent_drop" and dragged
 *  the whole muscle group to "declining". Display, milestones, and the
 *  heaviest-weight PR axis all keep the real kg (`score`).
 *
 *  The axis UNIT is fixed per exercise by its `assisted_mode`, NOT by whether an
 *  individual log happens to parse as assisted — otherwise a %BW axis and a raw-kg
 *  axis could mix inside one exercise's history (e.g. an assisted pull-up that
 *  graduates to a weighted one) and cmpStrength would compare a ~70 %BW score
 *  against a ~25 kg score. A non-assisted exercise always scores in kg (any stray
 *  `bw-(assist)` syntax in imported/legacy raw is ignored); an assisted exercise
 *  scores in %BW, and a log with no assisted form has no bodyweight to convert, so
 *  it returns NaN — callers (toLogEntry) drop it from the axis rather than mixing. */
export function scoreWeight(p: Parsed, assistedMode: boolean): number {
  if (!assistedMode) return score(p);
  if (p.assisted && p.assisted.bw > 0) {
    return ((p.assisted.bw - p.assisted.assist) / p.assisted.bw) * 100;
  }
  return NaN;
}

/** The strength-axis value fed into e1rm / cmpStrength / the trend.
 *  Non-assisted: Epley e1RM in kg (folds weight × reps into one number).
 *  Assisted: the plain %BW lifted (scoreWeight) with NO Epley. An assisted
 *  movement's true 1RM ceiling IS bodyweight (100% BW = zero assist), so
 *  projecting an e1RM above that is both physically meaningless AND misread as
 *  "lifted >100% of bodyweight" (a 10-rep set at 80% BW minted a 106% "e1RM").
 *  The honest axis is simply how much of your bodyweight you moved — it climbs
 *  toward 100% as assist drops, then you graduate to weighted. Reps no longer
 *  inflate the number; they still break ties in cmpStrength. */
export function strengthScore(sw: number, repsStr: string, assistedMode: boolean): number {
  return assistedMode ? sw : epley1RM(sw, repsStr);
}

// ─── toLogEntry ──────────────────────────────────────────────────────────────

export function toLogEntry(log: TrainingLog, setCount: number, assistedMode: boolean): LogEntry | null {
  if (!log.raw) return null;
  const parsed = parse(log.raw);
  if (!parsed) return null;
  const weightKg = score(parsed);
  if (!Number.isFinite(weightKg)) return null;
  // Score axes run on scoreWeight (%BW for an assisted-mode exercise, kg otherwise);
  // weightKg stays the real kg for display, milestones, and the heaviest-weight PR
  // axis. On an assisted-mode exercise a log with no assisted form can't sit on the
  // %BW axis (no bodyweight to convert) → scoreWeight is NaN → drop it from the
  // axes rather than mixing raw kg into a %BW trend.
  const sw = scoreWeight(parsed, assistedMode);
  if (!Number.isFinite(sw)) return null;
  return {
    log,
    weightKg,
    reps: parsed.reps,
    // Assisted exercises skip Epley: e1rm holds the plain %BW lifted, not a 1RM
    // projection (see strengthScore for why >100% BW is meaningless there).
    e1rm: strengthScore(sw, parsed.reps, assistedMode),
    totalReps: totalReps(parsed.reps, setCount),
    // Best-set tonnage = top-set weight × its reps, UNCAPPED (unlike e1rm, which
    // caps reps at 12 because Epley degrades past that). For hypertrophy the high
    // reps ARE the stimulus — capping here would score 10×16 as 10×12 and re-open
    // the very false-positive tonnage exists to close (10×16=160 must stay 160).
    tonnage: sw > 0 ? sw * maxReps(parsed.reps) : 0,
  };
}

/**
 * "Which set is stronger" — the single ordering the whole training tab uses for
 * PRs, status, and history deltas, so the badge and the trend never disagree.
 * Hybrid: estimated 1RM first (Epley folds weight × reps into one number, so a
 * heavier-but-fewer vs lighter-but-more tradeoff resolves cleanly); rounded to
 * the same 1-decimal precision shown in the UI, so two sets that *display* the
 * same e1RM always compare as tied instead of one silently winning on a
 * fractional difference the user never sees. On a tie, more total reps
 * actually performed wins (see `totalReps` — a single-number reps string
 * expands across the exercise's set count first); a full tie returns 0 and
 * the caller keeps whoever came first. Returns >0 when `a` beats `b`, <0
 * when weaker, 0 when equal.
 */
type CmpFields = Pick<LogEntry, "e1rm" | "totalReps" | "tonnage" | "weightKg">;

export function cmpStrength(a: CmpFields, b: CmpFields, mode: ScoreMode): number {
  if (mode === "isolation") {
    // Total work first (tonnage folds weight × reps); at a tie, higher mechanical
    // tension wins (heavier load), then more reps. The tie-break defines a
    // philosophy — tonnage already credits reps, so equal tonnage tips to load —
    // even though it almost never fires in practice.
    const at = Math.round(a.tonnage * 10) / 10;
    const bt = Math.round(b.tonnage * 10) / 10;
    if (at !== bt) return at - bt;
    const aw = Math.round(a.weightKg * 10) / 10;
    const bw = Math.round(b.weightKg * 10) / 10;
    if (aw !== bw) return aw - bw;
    return a.totalReps - b.totalReps;
  }
  const ae1 = Math.round(a.e1rm * 10) / 10;
  const be1 = Math.round(b.e1rm * 10) / 10;
  if (ae1 !== be1) return ae1 - be1;
  return a.totalReps - b.totalReps;
}

/** Does `a` set a new record over `best`? No existing best always counts as new. */
function beatsBest(
  a: CmpFields,
  best: CmpFields | null,
  mode: ScoreMode,
): boolean {
  return !best || cmpStrength(a, best, mode) > 0;
}

// ─── PR classification (log-time feedback only) ──────────────────────────────
// The health card judges strength on e1RM alone (overview/api.ts) — the right
// *status* axis, but blind to a heavier top set that Epley rates at the same or
// even a lower e1RM (77kg×7 ≈ 75kg×8). So the feedback shown when you log a set
// splits a new best into two kinds, WITHOUT touching cmpStrength (still the one
// comparator for status/trend/history, so nothing there can disagree):
//   Strength PR    — a new estimated-1RM ceiling (the gold moment).
//   Performance PR — real work e1RM misses: the heaviest weight ever actually
//                    completed, or more total reps than the record at a tied
//                    ceiling.
// Milestone (round-number weights) isn't here yet — it needs a per-exercise
// boundary rule.
export interface PRBests {
  /** Highest estimated 1RM across the history (kg). */
  e1rm: number;
  /** Heaviest weight actually completed across the history (kg). */
  weightKg: number;
  /** Highest best-set tonnage across the history (kg·reps) — the isolation axis. */
  tonnage: number;
}

/** The PR axes' all-time bests from a set of logs. Pass the history the new
 *  set is measured against — i.e. excluding the set being classified. */
export function computePRBests(logs: TrainingLog[], setCount: number, assistedMode: boolean): PRBests {
  let e1rm = 0;
  let weightKg = 0;
  let tonnage = 0;
  for (const l of logs) {
    const e = toLogEntry(l, setCount, assistedMode);
    if (!e) continue;
    if (e.e1rm > e1rm) e1rm = e.e1rm;
    if (e.weightKg > weightKg) weightKg = e.weightKg;
    if (e.tonnage > tonnage) tonnage = e.tonnage;
  }
  return { e1rm, weightKg, tonnage };
}

/** The gold moment, split by lift type: `strength` = new e1RM ceiling (compound),
 *  `hypertrophy` = new best-set tonnage ceiling (isolation), `performance` = the
 *  compound consolation (heaviest weight / more reps at a tied e1RM ceiling). */
export type PRKind = "strength" | "hypertrophy" | "performance" | null;

/** Classify a freshly-logged set against the prior bests, per the lift's
 *  ScoreMode. Isolation: any new cmpStrength best (led by a new tonnage ceiling)
 *  is a single Hypertrophy PR — one metric, one celebration, no sub-tier.
 *  Compound (unchanged): a new rounded-e1RM ceiling is a Strength PR; else a new
 *  heaviest completed weight, or more reps at a tied ceiling, is a Performance PR.
 *  Values are rounded to the 1-decimal the UI shows so a set that only *displays*
 *  as tying isn't mislabelled. The first-ever set (empty history) always PRs. */
export function classifyPR(
  entry: Pick<LogEntry, "e1rm" | "weightKg" | "totalReps" | "tonnage">,
  prev: PRBests,
  prevBest: Pick<LogEntry, "e1rm" | "totalReps" | "tonnage" | "weightKg"> | null,
  mode: ScoreMode,
): PRKind {
  if (mode === "isolation") {
    return beatsBest(entry, prevBest, mode) ? "hypertrophy" : null;
  }
  const e1 = Math.round(entry.e1rm * 10) / 10;
  const prevE1 = Math.round(prev.e1rm * 10) / 10;
  if (e1 > prevE1) return "strength";
  if (entry.weightKg > prev.weightKg) return "performance";
  if (prevBest && cmpStrength(entry, prevBest, mode) > 0) return "performance";
  return null;
}

// ─── computeStats ────────────────────────────────────────────────────────────

export interface Stats {
  best: LogEntry | null;
  prIndex: number; // index in filtered logs array (sorted by date asc)
  latest: LogEntry | null;
}

/** logs should be sorted chronological ascending (oldest first). */
export function computeStats(logs: TrainingLog[], setCount: number, mode: ScoreMode, assistedMode: boolean): Stats {
  const entries = logs.map((l) => toLogEntry(l, setCount, assistedMode)).filter((e): e is LogEntry => e !== null);
  if (!entries.length) return { best: null, prIndex: -1, latest: null };

  // PR = strongest set by cmpStrength (per mode: e1RM or tonnage, then tie-breaks).
  // Strict > with the ascending order means on a full tie the earliest entry keeps
  // the PR — whoever hit it first owns the record.
  let best = entries[0];
  for (const e of entries) {
    if (cmpStrength(e, best, mode) > 0) best = e;
  }

  const prIndex = logs.indexOf(best.log);
  const latest = entries[entries.length - 1];
  return { best, prIndex, latest };
}

export interface PrEvent {
  date: string;
  /** The scoring-axis value at the PR — e1RM (compound), best-set tonnage
   *  (isolation), or %BW-lifted (assisted); the axis `mode`/`assistedMode`
   *  select, matching cmpStrength. Unit varies, so surfaces that mix lifts show
   *  weight×reps rather than this raw number. */
  score: number;
  weightKg: number;
  reps: string;
}

/** The chronological sequence of PR *events* for one lift: each date the lift
 *  set a new all-time best by the app's own comparator (cmpStrength — the same
 *  ordering the PR badge and confetti use), not raw e1rm. The FIRST logged set
 *  establishes the record without emitting an event (it isn't a "new" PR, and
 *  a dot on every lift's first day would just be noise); every later set that
 *  beats the running best is an event. `logs` may be in any order — sorted
 *  ascending internally. Used by the PR + Phase timeline to attribute each
 *  breakthrough to the phase it happened in. */
export function buildPrEvents(
  logs: TrainingLog[],
  setCount: number,
  mode: ScoreMode,
  assistedMode: boolean,
): PrEvent[] {
  const entries = logs
    .map((l) => toLogEntry(l, setCount, assistedMode))
    .filter((e): e is LogEntry => e !== null && !!e.log.log_date)
    .sort((a, b) => (a.log.log_date! < b.log.log_date! ? -1 : a.log.log_date! > b.log.log_date! ? 1 : 0));

  const events: PrEvent[] = [];
  let best: LogEntry | null = null;
  for (const e of entries) {
    if (best && cmpStrength(e, best, mode) <= 0) continue;
    const isImprovement = best !== null; // skip the record-establishing first set
    best = e;
    if (isImprovement) {
      events.push({
        date: e.log.log_date!,
        score: mode === "isolation" ? e.tonnage : e.e1rm,
        weightKg: e.weightKg,
        reps: e.reps,
      });
    }
  }
  return events;
}

// ─── Trend series (for the exercise sparkline) ───────────────────────────────

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  e1rm: number; // Epley 1RM in kg — the compound (strength) trend number
  tonnage: number; // best-set weight × reps — the isolation (hypertrophy) trend number
  weightKg: number;
  reps: string;
}

/**
 * Chronological (ascending) est-1RM series for the exercise trend chart — one
 * point per logged day (the app already enforces one entry per exercise per
 * day). Entries with no finite positive e1RM (bodyweight-only or unparseable
 * sets) are dropped: they carry no strength value to plot.
 */
export function buildTrendSeries(logsAsc: TrainingLog[], setCount: number, assistedMode: boolean): TrendPoint[] {
  const pts: TrendPoint[] = [];
  for (const log of logsAsc) {
    if (!log.log_date) continue;
    const e = toLogEntry(log, setCount, assistedMode);
    if (!e || !(e.e1rm > 0)) continue;
    pts.push({ date: log.log_date, e1rm: e.e1rm, tonnage: e.tonnage, weightKg: e.weightKg, reps: e.reps });
  }
  // logsAsc arrives chronological, but an edited log_date can reorder it — a
  // defensive sort keeps the line reading left→right in real time order.
  pts.sort((a, b) => a.date.localeCompare(b.date));
  return pts;
}

const DAY_MS = 86400000;
function daysBetween(a: string, b: string): number {
  return Math.abs(
    new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime(),
  ) / DAY_MS;
}

export interface TrendWindow {
  points: TrendPoint[];
  /** true when the full history spanned >1 year and was clipped to 365 days. */
  clipped: boolean;
}

/**
 * The chart's time window: under a year of history shows everything; a year or
 * more shows only the most recent 365 days. The window is anchored to the
 * latest entry (not "today"), so a lapse in logging still lands the window on
 * real recent training instead of an empty stretch.
 */
export function windowTrend(points: TrendPoint[]): TrendWindow {
  if (points.length < 2) return { points, clipped: false };
  const first = points[0].date;
  const last = points[points.length - 1].date;
  if (daysBetween(first, last) <= 365) return { points, clipped: false };
  const cutoff = new Date(last + "T12:00:00").getTime() - 365 * DAY_MS;
  const windowed = points.filter(
    (p) => new Date(p.date + "T12:00:00").getTime() >= cutoff,
  );
  return { points: windowed, clipped: true };
}

// ─── computeHistDelta ────────────────────────────────────────────────────────

export interface HistDelta {
  text: string;
  direction: "gain" | "loss";
}

/**
 * Compare curr vs prev entry. Direction reuses cmpStrength directly — same
 * ordering as PRs/status — falling back to raw kg only on a genuine
 * cmpStrength tie (identical rounded e1RM and total reps). The label still
 * spells out the raw kg / reps change so the user sees what actually moved.
 */
export function computeHistDelta(
  curr: TrainingLog,
  prev: TrainingLog,
  setCount: number,
  mode: ScoreMode,
  assistedMode: boolean,
): HistDelta | null {
  if (!curr.raw || !prev.raw) return null;
  const cp = parse(curr.raw);
  const pp = parse(prev.raw);
  if (!cp || !pp) return null;

  const cKg = score(cp);
  const pKg = score(pp);
  if (!Number.isFinite(cKg) || !Number.isFinite(pKg)) return null;

  // Both sets must sit on the same score axis — on an assisted-mode exercise a
  // non-assisted log has no %BW score, so a vs-last delta across the two axes
  // would be meaningless. Stay silent rather than compare incomparable units.
  const cSwAxis = scoreWeight(cp, assistedMode);
  const pSwAxis = scoreWeight(pp, assistedMode);
  if (!Number.isFinite(cSwAxis) || !Number.isFinite(pSwAxis)) return null;

  const kgDelta = cKg - pKg;
  // Prefer the top-set delta — it's the per-set number the user reads. But when
  // the top set held and only the lower drop-set volume moved (10/10/10 →
  // 10/10/8), maxReps is unchanged and would print "0 reps" next to a direction
  // arrow. Fall back to the total-reps delta — the same quantity cmpStrength
  // used to pick the direction — so the number never contradicts the arrow.
  const maxRepsDelta = maxReps(cp.reps) - maxReps(pp.reps);
  const totalRepsDelta = totalReps(cp.reps, setCount) - totalReps(pp.reps, setCount);
  const repsDelta = maxRepsDelta !== 0 ? maxRepsDelta : totalRepsDelta;

  // Direction AND magnitude judge on the score axes (scoreWeight → %BW for an
  // assisted-mode exercise, so a lighter body doesn't read as a loss).
  const cSw = cSwAxis;
  const pSw = pSwAxis;
  // strengthScore, not epley1RM: assisted compares on plain %BW (no Epley),
  // otherwise a reps drop at equal-or-higher %BW flips the arrow against the
  // %BW magnitude shown next to it.
  const cE1 = strengthScore(cSw, cp.reps, assistedMode);
  const pE1 = strengthScore(pSw, pp.reps, assistedMode);
  const cmp = cmpStrength(
    { e1rm: cE1, totalReps: totalReps(cp.reps, setCount), tonnage: cSw * maxReps(cp.reps), weightKg: cKg },
    { e1rm: pE1, totalReps: totalReps(pp.reps, setCount), tonnage: pSw * maxReps(pp.reps), weightKg: pKg },
    mode,
  );

  // The magnitude shown next to the arrow, in the lift's native load unit: kg for
  // normal lifts, %BW for assisted (an assisted lift's kg is contaminated by
  // bodyweight change, exactly what the %BW axis exists to strip out). Direction
  // always comes from cmpStrength above; this is only what the number/unit reads.
  // The exercise's mode, not per-log syntax: the axis guard above already
  // ensures both logs are comparable, and a non-assisted exercise whose raws
  // happen to use bw-(assist) syntax scores in kg — labelling that delta "%"
  // would lie about the unit.
  const isAssistedPair = assistedMode;
  const loadDelta = isAssistedPair ? cSw - pSw : kgDelta;
  // Assisted deltas read in "%" — the "BW" is redundant next to the row's own
  // "= NN% BW" read-out, so the delta drops it and keeps just the percent (glued
  // to the number). kg keeps its leading space, like every other kg in the app.
  const loadUnit = isAssistedPair ? "%" : " kg";

  let direction: "gain" | "loss";
  if (cmp !== 0) {
    direction = cmp > 0 ? "gain" : "loss";
  } else if (loadDelta !== 0) {
    direction = loadDelta > 0 ? "gain" : "loss";
  } else {
    return null; // genuinely identical — stay silent
  }

  // Load is the headline metric — show it alone when it moved. Only fall back to
  // the reps delta when the load held and reps carried the change.
  const detail =
    Math.abs(loadDelta) >= (isAssistedPair ? 0.05 : 0.005)
      ? `${Math.abs(parseFloat(loadDelta.toFixed(isAssistedPair ? 1 : 2)))}${loadUnit}`
      : `${Math.abs(repsDelta)} reps`;

  return { text: `${direction === "gain" ? "▲" : "▼"} ${detail}`, direction };
}



// ─── Weekly training volume (Monday-anchored, split-completed) ───────────────

export interface WeeklyVolumeExercise {
  slug: string;
  /** The split this exercise belongs to — the carry-forward roster key. */
  split: string;
  /** Configured set count, so a single-number reps string ("7") expands to the
   *  full session's reps (see totalReps). */
  setCount: number;
  /** The exercise's assisted_mode — fixes the score axis unit (see scoreWeight). */
  assistedMode: boolean;
  /** Last date the lift was part of the program — callers set it to an
   *  archived lift's final log date. History up to it still counts (archiving
   *  must never rewrite what was actually lifted), but sessions after it stop
   *  carrying the lift forward: archiving is an *explicit* stop, so the
   *  no-log-means-maintained rule doesn't apply past this date. Omitted =
   *  active, maintained indefinitely. */
  activeUntil?: string;
}

/** One trained session (a split × date pair) and its carry-forward volume. */
export interface WeeklyVolumeSession {
  date: string; // YYYY-MM-DD
  split: string;
  volumeKg: number;
}

export interface WeeklyVolumeStat {
  /** Average kg per week over the trailing window — the last ≤4 *completed*
   *  Mon–Sun weeks (the in-progress week would dilute any average it joined).
   *  Weeks are *maintained*: a split with no logs in a week inherits its last
   *  logged week (沒記就是維持, see maintainedWeekRows) — an unlogged week is
   *  never a zero. Falls back to this week's total when the user's very first
   *  week is still in progress. */
  avgWeekKg: number;
  /** Completed weeks actually averaged (≤4, clipped to history; 0 → the
   *  first-week fallback above). */
  weeksCounted: number;
  /** % change: trailing-window average vs the previous window's average (the
   *  ≤4 completed weeks before those). null when the prior window has no
   *  training to compare against — MetricDelta then renders nothing. */
  deltaPct: number | null;
  /** This calendar week so far / last week's full total — the disclosure's
   *  per-week detail, no longer what the headline judges. */
  thisWeekKg: number;
  lastWeekKg: number;
  /** Per-session breakdown, newest-first — the disclosure detail rows. */
  thisWeekSessions: WeeklyVolumeSession[];
  lastWeekSessions: WeeklyVolumeSession[];
}

// Local YYYY-MM-DD — never toISOString(), which prints UTC and shifts the day
// off-by-one in any non-UTC timezone (the whole app anchors on local dates).
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (local) of the week `dateStr` (YYYY-MM-DD) falls in, as YYYY-MM-DD. */
function weekStartMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localYmd(d);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

/** Full working volume of one logged set: effective load × total reps performed
 *  (both sets folded in). Returns 0 for an unparseable / bodyweight-only log. */
function logVolume(log: TrainingLog, setCount: number, assistedMode: boolean): number {
  const e = toLogEntry(log, setCount, assistedMode);
  if (!e || e.weightKg <= 0) return 0;
  return e.weightKg * e.totalReps;
}

/** Per-exercise carry-forward volume for every session (split × date) in the
 *  week starting `weekStart` — the shared internals: computeWeeklyVolume sums
 *  these per session, computeMuscleWeeklyVolume re-buckets the same rows per
 *  muscle group, so the two views can never disagree on what a session was
 *  worth. */
type WeekRow = { date: string; split: string; ex: WeeklyVolumeExercise; volumeKg: number };

function weekExerciseRows(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  weekStart: string,
): WeekRow[] {
  const bySplit = new Map<string, WeeklyVolumeExercise[]>();
  for (const ex of roster) {
    const arr = bySplit.get(ex.split) ?? [];
    arr.push(ex);
    bySplit.set(ex.split, arr);
  }

  // Most recent set for `slug` on or before `date` — logs are newest-first, so
  // the first entry within range wins.
  const latestUpTo = (slug: string, date: string): TrainingLog | null => {
    for (const l of logs[slug] ?? []) {
      if (l.log_date && l.log_date <= date) return l;
    }
    return null;
  };

  const weekEndExcl = addDays(weekStart, 7);
  // split -> the distinct dates that split was trained this week
  const trained = new Map<string, Set<string>>();
  for (const ex of roster) {
    for (const l of logs[ex.slug] ?? []) {
      const d = l.log_date;
      if (d && d >= weekStart && d < weekEndExcl) {
        const set = trained.get(ex.split) ?? new Set<string>();
        set.add(d);
        trained.set(ex.split, set);
      }
    }
  }

  const rows: WeekRow[] = [];
  for (const [split, dates] of trained) {
    const rosterForSplit = bySplit.get(split) ?? [];
    for (const date of dates) {
      for (const ex of rosterForSplit) {
        // A retired lift doesn't ride along on sessions after its last log —
        // its history ends where its records end.
        if (ex.activeUntil && date > ex.activeUntil) continue;
        const src = latestUpTo(ex.slug, date);
        if (src) rows.push({ date, split, ex, volumeKg: logVolume(src, ex.setCount, ex.assistedMode) });
      }
    }
  }
  return rows;
}

// Averaging window: 4 completed weeks ≈ one programming mesocycle — long
// enough to absorb session-to-session scheduling noise, short enough that the
// average still describes the *current* program.
const WINDOW_WEEKS = 4;

/** Monday of the week holding the roster's earliest log — history's left
 *  edge; weeks before it carry no signal. Scoped to the roster (not every
 *  slug in `logs`): an archived exercise's ancient logs must not stretch the
 *  windows over weeks the current program has no state for, which would read
 *  as dilution. `fallback` when the roster has no logs at all. */
function firstLogWeek(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  fallback: string,
): string {
  let firstDate: string | null = null;
  for (const ex of roster)
    for (const l of logs[ex.slug] ?? [])
      if (l.log_date && (firstDate === null || l.log_date < firstDate)) firstDate = l.log_date;
  return firstDate ? weekStartMonday(firstDate) : fallback;
}

/** Trailing / previous averaging windows as week-start dates, newest-first.
 *  `window` = the last ≤WINDOW_WEEKS completed Mon–Sun weeks; `prev` = the
 *  ≤WINDOW_WEEKS before those (the delta baseline). Both are clipped to
 *  history: weeks before the roster's first log carry no signal and would
 *  only dilute the averages. */
function trailingWindows(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  thisWeekStart: string,
): { window: string[]; prev: string[] } {
  const firstWeek = firstLogWeek(logs, roster, thisWeekStart);

  const window: string[] = [];
  const prev: string[] = [];
  for (let i = 1; i <= WINDOW_WEEKS * 2; i++) {
    const w = addDays(thisWeekStart, -7 * i);
    if (w < firstWeek) break;
    (i <= WINDOW_WEEKS ? window : prev).push(w);
  }
  return { window, prev };
}

/** 沒記就是維持 — no log means maintained. A week with no logged session of a
 *  split inherits that split's most recent *logged* week wholesale (same
 *  sessions, volumes, sets): the user logs sparsely, so an unlogged week reads
 *  "same as last time", never zero. This is the exercise-level carry-forward
 *  applied one level up — without it the averaging windows read logging gaps
 *  as volume crashes and the delta narrates logging cadence, not training.
 *  A split with no log on or before `weekStart` contributes nothing (there is
 *  no state to maintain yet). */
function maintainedWeekRows(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  weekStart: string,
  rowsCache: Map<string, WeekRow[]>,
): WeekRow[] {
  const rowsAt = (w: string): WeekRow[] => {
    let r = rowsCache.get(w);
    if (!r) {
      r = weekExerciseRows(logs, roster, w);
      rowsCache.set(w, r);
    }
    return r;
  };
  const out: WeekRow[] = [];
  for (const split of new Set(roster.map((ex) => ex.split))) {
    // The split's most recent logged week on or before `weekStart` — the week
    // whose shape this week maintains.
    let effective: string | null = null;
    for (const ex of roster) {
      if (ex.split !== split) continue;
      for (const l of logs[ex.slug] ?? []) {
        if (!l.log_date) continue;
        const w = weekStartMonday(l.log_date);
        if (w <= weekStart && (effective === null || w > effective)) effective = w;
      }
    }
    if (effective !== null)
      out.push(
        ...rowsAt(effective).filter(
          (r) =>
            r.split === split &&
            // Inheritance carries a week's shape forward, but never a retired
            // lift past its archival: keep it only while the target week still
            // overlaps its active life.
            (!r.ex.activeUntil || weekStart <= r.ex.activeUntil),
        ),
      );
  }
  return out;
}

/**
 * Weekly training volume with split-completion carry-forward.
 *
 * The unit is a *session*: any day you logged at least one exercise of a split
 * counts as having trained that whole split. Exercises you didn't re-log that
 * day carry forward their most recent prior set (the one active as of the
 * session date) — so a Pull day where you only logged one new set still sums
 * the full Pull-roster volume, instead of collapsing to that single set.
 *
 * `logs` is keyed by slug, each array newest-first (as loaded). The headline is
 * the trailing ≤4-completed-week average (see trailingWindows), judged against
 * the previous window's average — week-vs-week was too noisy to steer by.
 * `today` is the reference date; this week and last week are still broken out
 * for the disclosure rows.
 */
export function computeWeeklyVolume(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  today: string,
): WeeklyVolumeStat {
  const weekSessions = (weekStart: string): WeeklyVolumeSession[] => {
    const perSession = new Map<string, WeeklyVolumeSession>();
    for (const r of weekExerciseRows(logs, roster, weekStart)) {
      const key = `${r.split} ${r.date}`;
      const s = perSession.get(key) ?? { date: r.date, split: r.split, volumeKg: 0 };
      s.volumeKg += r.volumeKg;
      perSession.set(key, s);
    }
    const sessions = [...perSession.values()];
    sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return sessions;
  };

  const sumKg = (arr: WeeklyVolumeSession[]) => arr.reduce((s, x) => s + x.volumeKg, 0);

  const thisWeekStart = weekStartMonday(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const thisWeekSessions = weekSessions(thisWeekStart);
  const lastWeekSessions = weekSessions(lastWeekStart);
  const thisWeekKg = sumKg(thisWeekSessions);
  const lastWeekKg = sumKg(lastWeekSessions);

  const { window, prev } = trailingWindows(logs, roster, thisWeekStart);
  // Averages run on *maintained* weeks (unlogged split-weeks inherit the
  // split's last logged week — 沒記就是維持), while the disclosure's this/last
  // week rows above stay strictly what was logged.
  const rowsCache = new Map<string, WeekRow[]>();
  const maintainedKg = (w: string) =>
    maintainedWeekRows(logs, roster, w, rowsCache).reduce((s, r) => s + r.volumeKg, 0);
  const avgOf = (weeks: string[]) =>
    weeks.reduce((s, w) => s + maintainedKg(w), 0) / weeks.length;
  // No completed week yet (user's first week): the in-progress week is the
  // best available picture of "a week".
  const avgWeekKg = window.length > 0 ? avgOf(window) : thisWeekKg;
  const prevAvg = prev.length > 0 ? avgOf(prev) : 0;
  const deltaPct = prevAvg > 0 ? ((avgWeekKg - prevAvg) / prevAvg) * 100 : null;

  return {
    avgWeekKg,
    weeksCounted: window.length,
    deltaPct,
    thisWeekKg,
    lastWeekKg,
    thisWeekSessions,
    lastWeekSessions,
  };
}

/** Average weekly working sets re-bucketed by muscle group instead of split. */
export interface MuscleVolumeStat {
  /** Muscle group name (inferMuscleGroup output via the caller's muscleOf). */
  group: string;
  /** Average working sets per week over the trailing window — the same ≤4
   *  completed weeks as WeeklyVolumeStat.avgWeekKg, so the two reads share a
   *  basis. Low rows are the under-volumed muscles. */
  avgWeekSets: number;
  /** Previous window's average — deltaSets' baseline. null when there is no
   *  prior window yet. */
  prevAvgWeekSets: number | null;
  /** avgWeekSets − prevAvgWeekSets — absolute, not %: the counts are small,
   *  so % would just amplify sub-set noise. null when there's no prior window
   *  to compare against. */
  deltaSets: number | null;
  /** Distinct slugs contributing sets in the trailing window — the drill-down
   *  evidence. */
  slugs: string[];
}

/**
 * Average weekly working SETS per muscle group — the same sessions, carry-
 * forward and trailing-window average as computeWeeklyVolume (it re-buckets
 * the same per-exercise rows), but counted in sets, not kg: tonnage isn't
 * comparable across muscle groups (leg loads dwarf arm loads regardless of
 * effort), while sets-per-muscle-per-week is the unit programming actually
 * speaks. Sets also credit zero-tonnage rows (bodyweight / unparseable logs)
 * that the kg view can't see. `muscleOf` maps a roster exercise to its group
 * (callers build it from inferMuscleGroup — no schema, inference only).
 * Groups sorted by trailing average. Weeks run through maintainedWeekRows
 * (沒記就是維持): a split-week without logs inherits the split's last logged
 * week, so a muscle only reads lower when a *logged* week actually shrank —
 * never because logging paused.
 */
export function computeMuscleWeeklyVolume(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  today: string,
  muscleOf: (ex: WeeklyVolumeExercise) => string,
): MuscleVolumeStat[] {
  const thisWeekStart = weekStartMonday(today);
  const { window, prev } = trailingWindows(logs, roster, thisWeekStart);
  // First-week fallback mirrors avgWeekKg's: no completed week yet → the
  // in-progress week is the best available picture.
  const winWeeks = window.length > 0 ? window : [thisWeekStart];

  const groups = new Map<string, { winSets: number; prevSets: number; slugs: Set<string> }>();
  const bucket = (group: string) => {
    const g = groups.get(group) ?? { winSets: 0, prevSets: 0, slugs: new Set<string>() };
    groups.set(group, g);
    return g;
  };
  const rowsCache = new Map<string, WeekRow[]>();
  for (const w of winWeeks)
    for (const r of maintainedWeekRows(logs, roster, w, rowsCache)) {
      const g = bucket(muscleOf(r.ex));
      g.winSets += r.ex.setCount;
      g.slugs.add(r.ex.slug);
    }
  for (const w of prev)
    for (const r of maintainedWeekRows(logs, roster, w, rowsCache))
      bucket(muscleOf(r.ex)).prevSets += r.ex.setCount;

  return [...groups.entries()]
    .map(([group, g]) => {
      const avgWeekSets = g.winSets / winWeeks.length;
      const prevAvgWeekSets = prev.length > 0 ? g.prevSets / prev.length : null;
      return {
        group,
        avgWeekSets,
        prevAvgWeekSets,
        deltaSets: prevAvgWeekSets === null ? null : avgWeekSets - prevAvgWeekSets,
        slugs: [...g.slugs],
      };
    })
    .sort((a, b) => b.avgWeekSets - a.avgWeekSets || a.group.localeCompare(b.group));
}

/** One bar of the Weekly Volume trend sheet. */
export interface WeeklyVolumeTrendPoint {
  weekStart: string; // Monday, YYYY-MM-DD
  /** Maintained weekly total — the same 沒記就是維持 basis as avgWeekKg. */
  kg: number;
  /** ≥1 actual log that week. false = the whole week is carried forward —
   *  maintained is honest, but it isn't a record, so the chart dims it. */
  logged: boolean;
}

/**
 * The last ≤`weeks` completed Mon–Sun weeks of maintained weekly volume,
 * oldest-first — the trend sheet's series. Clipped to history like the
 * averaging windows; the in-progress week is excluded for the same reason it
 * stays out of avgWeekKg (a partial bar reads as a crash).
 */
export function computeWeeklyVolumeTrend(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  today: string,
  weeks = 12,
): WeeklyVolumeTrendPoint[] {
  const thisWeekStart = weekStartMonday(today);
  const firstWeek = firstLogWeek(logs, roster, thisWeekStart);
  const rowsCache = new Map<string, WeekRow[]>();
  const out: WeeklyVolumeTrendPoint[] = [];
  for (let i = weeks; i >= 1; i--) {
    const w = addDays(thisWeekStart, -7 * i);
    if (w < firstWeek) continue;
    out.push({
      weekStart: w,
      kg: maintainedWeekRows(logs, roster, w, rowsCache).reduce((s, r) => s + r.volumeKg, 0),
      logged: weekExerciseRows(logs, roster, w).length > 0,
    });
  }
  return out;
}

// ─── Session split rotation ──────────────────────────────────────────────────

/** The split the Training page should land on when it opens. Rotation-aware:
 *  once a calendar day has passed since the last logged set, the session ahead
 *  is the NEXT split in the rotation (after the last-logged one, wrapping), so
 *  landing there means no manual split pick before logging. A same-day return
 *  stays on the last-logged split — that session is still the current one.
 *  `null` = no logs yet or unmappable slug: keep the caller's current split. */
export function nextSessionSplit(
  exercises: { slug: string; split: string }[],
  logsBySlug: Record<string, TrainingLog[]>,
  splitIds: readonly string[],
  today: string,
): string | null {
  // Each slug's list is newest-first (fetchLogsBySlug orders log_date desc),
  // so its head is that lift's latest; the overall latest is the max of heads.
  let latest: TrainingLog | null = null;
  for (const list of Object.values(logsBySlug)) {
    const head = list[0];
    if (!head) continue;
    if (
      !latest ||
      head.log_date > latest.log_date ||
      (head.log_date === latest.log_date && head.created_at > latest.created_at)
    ) {
      latest = head;
    }
  }
  if (!latest) return null;
  const lastSlug = latest.exercise_slug;
  const split = exercises.find((e) => e.slug === lastSlug)?.split;
  const idx = split ? splitIds.indexOf(split) : -1;
  if (idx === -1) return null;
  return latest.log_date < today ? splitIds[(idx + 1) % splitIds.length] : splitIds[idx];
}
