// Pure stat functions operating on TrainingLog[] from Supabase.

import type { TrainingLog } from "./api";
import { parse, score } from "./parser";

export type TimeFilter = "3mo" | "year" | "all";

export interface LogEntry {
  log: TrainingLog;
  weightKg: number;
  reps: string;
  e1rm: number;
  totalReps: number;
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

export function epley1RM(weightKg: number, repsStr: string): number {
  const maxR = maxReps(repsStr);
  if (!maxR || !weightKg || weightKg <= 0) return 0;
  return weightKg * (1 + maxR / 30);
}

// ─── toLogEntry ──────────────────────────────────────────────────────────────

export function toLogEntry(log: TrainingLog, setCount: number): LogEntry | null {
  if (!log.raw) return null;
  const parsed = parse(log.raw);
  if (!parsed) return null;
  const weightKg = score(parsed);
  if (!Number.isFinite(weightKg)) return null;
  return {
    log,
    weightKg,
    reps: parsed.reps,
    e1rm: epley1RM(weightKg, parsed.reps),
    totalReps: totalReps(parsed.reps, setCount),
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
export function cmpStrength(a: Pick<LogEntry, "e1rm" | "totalReps">, b: Pick<LogEntry, "e1rm" | "totalReps">): number {
  const ae1 = Math.round(a.e1rm * 10) / 10;
  const be1 = Math.round(b.e1rm * 10) / 10;
  if (ae1 !== be1) return ae1 - be1;
  return a.totalReps - b.totalReps;
}

/** Does `a` set a new record over `best`? No existing best always counts as new. */
export function beatsBest(
  a: Pick<LogEntry, "e1rm" | "totalReps">,
  best: Pick<LogEntry, "e1rm" | "totalReps"> | null,
): boolean {
  return !best || cmpStrength(a, best) > 0;
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
}

/** The two PR axes' all-time bests from a set of logs. Pass the history the new
 *  set is measured against — i.e. excluding the set being classified. */
export function computePRBests(logs: TrainingLog[], setCount: number): PRBests {
  let e1rm = 0;
  let weightKg = 0;
  for (const l of logs) {
    const e = toLogEntry(l, setCount);
    if (!e) continue;
    if (e.e1rm > e1rm) e1rm = e.e1rm;
    if (e.weightKg > weightKg) weightKg = e.weightKg;
  }
  return { e1rm, weightKg };
}

export type PRKind = "strength" | "performance" | null;

/** Classify a freshly-logged set against the prior bests. A new rounded-e1RM
 *  ceiling is a Strength PR; otherwise a new heaviest completed weight — or more
 *  total reps than the record at a tied ceiling — is a Performance PR; anything
 *  else is not a PR. e1RM is rounded to the same 1-decimal the UI shows, so a
 *  set that only *displays* as tying the ceiling isn't mislabelled a Strength
 *  PR. The first-ever set (empty history) counts as a Strength PR. */
export function classifyPR(
  entry: Pick<LogEntry, "e1rm" | "weightKg" | "totalReps">,
  prev: PRBests,
  prevBest: Pick<LogEntry, "e1rm" | "totalReps"> | null,
): PRKind {
  const e1 = Math.round(entry.e1rm * 10) / 10;
  const prevE1 = Math.round(prev.e1rm * 10) / 10;
  if (e1 > prevE1) return "strength";
  if (entry.weightKg > prev.weightKg) return "performance";
  if (prevBest && cmpStrength(entry, prevBest) > 0) return "performance";
  return null;
}

// ─── computeStats ────────────────────────────────────────────────────────────

export interface Stats {
  best: LogEntry | null;
  prIndex: number; // index in filtered logs array (sorted by date asc)
  latest: LogEntry | null;
}

/** logs should be sorted chronological ascending (oldest first). */
export function computeStats(logs: TrainingLog[], setCount: number): Stats {
  const entries = logs.map((l) => toLogEntry(l, setCount)).filter((e): e is LogEntry => e !== null);
  if (!entries.length) return { best: null, prIndex: -1, latest: null };

  // PR = strongest set by cmpStrength (e1RM, then reps). Strict > with the
  // ascending order means on a full tie the earliest entry keeps the PR —
  // whoever hit it first owns the record.
  let best = entries[0];
  for (const e of entries) {
    if (cmpStrength(e, best) > 0) best = e;
  }

  const prIndex = logs.indexOf(best.log);
  const latest = entries[entries.length - 1];
  return { best, prIndex, latest };
}

// ─── Trend series (for the exercise sparkline) ───────────────────────────────

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  e1rm: number; // Epley 1RM in kg — the app's canonical strength number
  weightKg: number;
  reps: string;
}

/**
 * Chronological (ascending) est-1RM series for the exercise trend chart — one
 * point per logged day (the app already enforces one entry per exercise per
 * day). Entries with no finite positive e1RM (bodyweight-only or unparseable
 * sets) are dropped: they carry no strength value to plot.
 */
export function buildTrendSeries(logsAsc: TrainingLog[], setCount: number): TrendPoint[] {
  const pts: TrendPoint[] = [];
  for (const log of logsAsc) {
    if (!log.log_date) continue;
    const e = toLogEntry(log, setCount);
    if (!e || !(e.e1rm > 0)) continue;
    pts.push({ date: log.log_date, e1rm: e.e1rm, weightKg: e.weightKg, reps: e.reps });
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
): HistDelta | null {
  if (!curr.raw || !prev.raw) return null;
  const cp = parse(curr.raw);
  const pp = parse(prev.raw);
  if (!cp || !pp) return null;

  const cKg = score(cp);
  const pKg = score(pp);
  if (!Number.isFinite(cKg) || !Number.isFinite(pKg)) return null;

  const kgDelta = cKg - pKg;
  // Prefer the top-set delta — it's the per-set number the user reads. But when
  // the top set held and only the lower drop-set volume moved (10/10/10 →
  // 10/10/8), maxReps is unchanged and would print "0 reps" next to a direction
  // arrow. Fall back to the total-reps delta — the same quantity cmpStrength
  // used to pick the direction — so the number never contradicts the arrow.
  const maxRepsDelta = maxReps(cp.reps) - maxReps(pp.reps);
  const totalRepsDelta = totalReps(cp.reps, setCount) - totalReps(pp.reps, setCount);
  const repsDelta = maxRepsDelta !== 0 ? maxRepsDelta : totalRepsDelta;

  const cE1 = epley1RM(cKg, cp.reps);
  const pE1 = epley1RM(pKg, pp.reps);
  const cmp = cmpStrength(
    { e1rm: cE1, totalReps: totalReps(cp.reps, setCount) },
    { e1rm: pE1, totalReps: totalReps(pp.reps, setCount) },
  );
  let direction: "gain" | "loss";
  if (cmp !== 0) {
    direction = cmp > 0 ? "gain" : "loss";
  } else if (kgDelta !== 0) {
    direction = kgDelta > 0 ? "gain" : "loss";
  } else {
    return null; // genuinely identical — stay silent
  }

  // Weight is the headline metric — show kg alone when it moved. Only fall back
  // to the reps delta when the weight held and reps carried the change.
  const detail =
    kgDelta !== 0
      ? `${Math.abs(parseFloat(kgDelta.toFixed(2)))}kg`
      : `${Math.abs(repsDelta)} reps`;

  return { text: `${direction === "gain" ? "▲" : "▼"} ${detail}`, direction };
}

// ─── timelineDate ────────────────────────────────────────────────────────────

const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export function timelineDate(isoDate: string): { mon: string; day: string } {
  if (!isoDate) return { mon: "", day: "" };
  const d = new Date(isoDate + "T12:00:00");
  if (isNaN(d.getTime())) return { mon: "", day: String(isoDate) };
  return {
    mon: MONTH_ABBR[d.getMonth()],
    day: String(d.getDate()).padStart(2, "0"),
  };
}

