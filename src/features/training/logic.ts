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
    e1rm: epley1RM(sw, parsed.reps),
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
  const cE1 = epley1RM(cSw, cp.reps);
  const pE1 = epley1RM(pSw, pp.reps);
  const cmp = cmpStrength(
    { e1rm: cE1, totalReps: totalReps(cp.reps, setCount), tonnage: cSw * maxReps(cp.reps), weightKg: cKg },
    { e1rm: pE1, totalReps: totalReps(pp.reps, setCount), tonnage: pSw * maxReps(pp.reps), weightKg: pKg },
    mode,
  );

  // The magnitude shown next to the arrow, in the lift's native load unit: kg for
  // normal lifts, %BW for assisted (an assisted lift's kg is contaminated by
  // bodyweight change, exactly what the %BW axis exists to strip out). Direction
  // always comes from cmpStrength above; this is only what the number/unit reads.
  const isAssistedPair = !!(cp.assisted && pp.assisted);
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
}

/** One trained session (a split × date pair) and its carry-forward volume. */
export interface WeeklyVolumeSession {
  date: string; // YYYY-MM-DD
  split: string;
  volumeKg: number;
}

export interface WeeklyVolumeStat {
  /** Total kg lifted this calendar week (Mon–Sun), with carry-forward. */
  thisWeekKg: number;
  /** Last week's full total (Mon–Sun) — the disclosure's "beat this" reference. */
  lastWeekKg: number;
  /** Last week's total *through the same weekday as today* — the pace-matched
   *  baseline the delta actually judges, so a Monday-only week isn't compared
   *  against last week's full four-session total. */
  lastWeekKgToDate: number;
  /** Last date in last week included in `lastWeekKgToDate` (weekday-aligned to
   *  today). Sessions after it are "ahead of where you are now". */
  lastWeekCutoff: string;
  /** % change: this week-to-date vs last week-to-date (pace-matched). null when
   *  there's no comparable prior-week baseline yet (can't judge against zero) —
   *  MetricDelta then renders nothing. Converges to full-vs-full by Sunday. */
  deltaPct: number | null;
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

/**
 * Weekly training volume with split-completion carry-forward.
 *
 * The unit is a *session*: any day you logged at least one exercise of a split
 * counts as having trained that whole split. Exercises you didn't re-log that
 * day carry forward their most recent prior set (the one active as of the
 * session date) — so a Pull day where you only logged one new set still sums
 * the full Pull-roster volume, instead of collapsing to that single set.
 *
 * `logs` is keyed by slug, each array newest-first (as loaded). Compared this
 * calendar week (Mon-anchored) vs last week; `today` is the reference date.
 */
export function computeWeeklyVolume(
  logs: Record<string, TrainingLog[]>,
  roster: WeeklyVolumeExercise[],
  today: string,
): WeeklyVolumeStat {
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

  const weekSessions = (weekStart: string): WeeklyVolumeSession[] => {
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

    const sessions: WeeklyVolumeSession[] = [];
    for (const [split, dates] of trained) {
      const rosterForSplit = bySplit.get(split) ?? [];
      for (const date of dates) {
        let volumeKg = 0;
        for (const ex of rosterForSplit) {
          const src = latestUpTo(ex.slug, date);
          if (src) volumeKg += logVolume(src, ex.setCount, ex.assistedMode);
        }
        sessions.push({ date, split, volumeKg });
      }
    }
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

  // Pace-matched baseline: only count last week up to the same weekday as today,
  // so week-to-date is judged against week-to-date (not against last week's full
  // total, which early in the week always reads as a huge, alarming drop). By
  // Sunday the cutoff covers all of last week, so it converges to full-vs-full.
  const elapsed = Math.round(daysBetween(thisWeekStart, today)); // 0=Mon … 6=Sun
  const lastWeekCutoff = addDays(lastWeekStart, elapsed);
  const lastWeekKgToDate = sumKg(
    lastWeekSessions.filter((s) => s.date <= lastWeekCutoff),
  );
  const deltaPct =
    lastWeekKgToDate > 0
      ? ((thisWeekKg - lastWeekKgToDate) / lastWeekKgToDate) * 100
      : null;

  return {
    thisWeekKg,
    lastWeekKg,
    lastWeekKgToDate,
    lastWeekCutoff,
    deltaPct,
    thisWeekSessions,
    lastWeekSessions,
  };
}
