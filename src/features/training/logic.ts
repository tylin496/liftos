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
  const cutoff =
    filter === "year"
      ? new Date(now.getFullYear(), 0, 1)
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
  const repsDelta = maxReps(cp.reps) - maxReps(pp.reps); // display only, see `detail` below

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

// ─── Stagnation / Strength Retention ─────────────────────────────────────────

type RetentionStatus = "excellent" | "on-track" | "watch" | "review";
type TrendKind = "recovering" | "stable" | "declining";

export interface TrendResult {
  trend: TrendKind | "uncertain";
  change: number;
  refDate?: string;
  lastDate?: string;
}

export interface StagnationView {
  pct: number;
  status: string;
  showPR: boolean;
  prLabel: string;
  label: string;
  prFmt: string | null;
  prDate: string | null;
  expandable: boolean;
  reason: string | null;
  needsExplaining: boolean;
  t: TrendResult | null;
}

function computeStrengthRetention(logsAsc: TrainingLog[], setCount: number) {
  const entries = logsAsc.map((l) => toLogEntry(l, setCount)).filter((e): e is LogEntry => e !== null);
  if (!entries.length) return null;

  // Same PR metric as computeStats: strongest by cmpStrength (e1RM, then reps),
  // full ties kept by the earliest entry.
  let prEntry: LogEntry = entries[0];
  for (const e of entries) {
    if (cmpStrength(e, prEntry) > 0) prEntry = e;
  }
  const prE1RM = prEntry.e1rm;
  if (!prE1RM) return null;

  const mostRecentDate = entries[entries.length - 1].log.log_date;
  const recent = entries.filter((e) => e.log.log_date === mostRecentDate);
  let current: LogEntry = recent[0];
  for (const e of recent) { if (cmpStrength(e, current) > 0) current = e; }
  const currentE1RM = current.e1rm;
  if (!currentE1RM) return null;

  const pct = Math.min(currentE1RM / prE1RM, 1);

  let prevBest: LogEntry | null = null;
  for (const e of entries) {
    if (e.log.log_date === mostRecentDate) continue;
    if (!prevBest || cmpStrength(e, prevBest) > 0) prevBest = e;
  }
  const prRatio = prevBest?.e1rm ? currentE1RM / prevBest.e1rm : null;
  // Same strict ordering as the history list's PR badge (cmpStrength, not a
  // rounded %) — a hair's-breadth e1RM gain can round to 100% and fail a
  // `prBoost > 100` check even though it's a genuine new PR by total reps.
  // No-prevBest (first-ever session) is handled separately via isFirstPR, so
  // this only counts a strict beat of an actual prior session.
  const beatsPrevBest = prevBest != null && beatsBest(current, prevBest);

  let status: RetentionStatus;
  if (pct >= 0.97) status = "excellent";
  else if (pct >= 0.94) status = "on-track";
  else if (pct >= 0.90) status = "watch";
  else status = "review";

  return { pct, status, prEntry, prRatio, beatsPrevBest };
}

export function computeTrend(logsAsc: TrainingLog[], setCount: number): TrendResult | null {
  const entries = logsAsc.map((l) => toLogEntry(l, setCount)).filter((e): e is LogEntry => e !== null);
  if (entries.length < 2) return null;

  const sessionMap = new Map<string, number>();
  for (const e of entries) {
    const d = e.log.log_date ?? "";
    if (!sessionMap.has(d) || e.e1rm > sessionMap.get(d)!) sessionMap.set(d, e.e1rm);
  }

  const sessions = [...sessionMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (sessions.length < 2) return null;

  const last = sessions[sessions.length - 1][1];
  // Compare to the immediately previous session, not a fixed window back.
  // A fixed 3-sessions-back reference reads a dip-then-recover (V-shape) as
  // "declining" because the reference lands on the pre-dip high. The previous
  // session is never stale, so this matches the per-entry +Xkg delta.
  const refIdx = sessions.length - 2;
  const ref = sessions[refIdx][1];
  const change = (last - ref) / ref;

  if (Math.abs(change) > 0.5) {
    return { trend: "uncertain", change, refDate: sessions[refIdx][0], lastDate: sessions[sessions.length - 1][0] };
  }

  let trend: TrendKind;
  if (change > 0.02) trend = "recovering";
  else if (change < -0.02) trend = "declining";
  else trend = "stable";
  return { trend, change };
}

function countDecliningStreak(entries: LogEntry[]): number {
  let streak = 0;
  for (let i = entries.length - 1; i > 0; i--) {
    if (entries[i].e1rm < entries[i - 1].e1rm) streak++;
    else break;
  }
  return streak;
}

function countSessionsWithoutImprovement(entries: LogEntry[]): number {
  if (entries.length < 2) return 0;
  let peak = entries[0].e1rm;
  let stallStart = 0;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].e1rm > peak) { peak = entries[i].e1rm; stallStart = i; }
  }
  return entries.length - 1 - stallStart;
}

function daysSinceLastGap(entries: LogEntry[]): number {
  if (entries.length < 2) return 0;
  const last = new Date((entries[entries.length - 1].log.log_date ?? "") + "T12:00:00");
  const prev = new Date((entries[entries.length - 2].log.log_date ?? "") + "T12:00:00");
  return Math.round((last.getTime() - prev.getTime()) / 86400000);
}

export function fmtInspectorDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtInspectorEntry(entry: LogEntry): string {
  return `${parseFloat(entry.weightKg.toFixed(2))} × ${entry.reps}`;
}

function buildStatusReason(
  status: string,
  trend: string | undefined,
  entries: LogEntry[],
  prEntry: LogEntry | null,
  pct: number,
): string | null {
  if (status === "rebuilding") {
    return `Climbing back · ${Math.round(pct * 100)}% of PR`;
  }
  if (status === "review") {
    if (trend === "declining") {
      const streak = countDecliningStreak(entries);
      if (streak >= 2) return `${streak} declining sessions`;
    }
    const stall = countSessionsWithoutImprovement(entries);
    if (stall >= 3) return `No improvement in ${stall} sessions`;
    if (prEntry?.log.log_date) {
      const days = Math.round(
        (Date.now() - new Date(prEntry.log.log_date + "T12:00:00").getTime()) / 86400000,
      );
      if (days > 30) return `Last PR: ${days} days ago`;
    }
    return null;
  }
  if (status === "watch") {
    if (entries.length <= 3) return `Only ${entries.length} recent session${entries.length === 1 ? "" : "s"}`;
    if (daysSinceLastGap(entries) > 21) return "Returning from a break";
    return null;
  }
  if (status === "on-track") return "Maintaining strength";
  if (status === "excellent" && prEntry?.log.log_date) {
    const days = Math.round(
      (Date.now() - new Date(prEntry.log.log_date + "T12:00:00").getTime()) / 86400000,
    );
    if (days <= 30) return "New PR this month";
  }
  return null;
}

const RETENTION_LABELS: Record<string, string> = {
  excellent: "Excellent",
  "on-track": "On Track",
  watch: "Below PR",
  review: "Review",
  rebuilding: "Rebuilding",
};

/** Pass ALL logs (not time-filtered) so the badge reflects the all-time PR. */
export function buildStagnationView(logsAsc: TrainingLog[], setCount: number): StagnationView | null {
  const s = computeStrengthRetention(logsAsc, setCount);
  const t = computeTrend(logsAsc, setCount);
  if (!s) return null;

  const { pct, status: baseStatus, prEntry, prRatio, beatsPrevBest } = s;
  // Direction beats distance-from-PR: if you're below PR but the latest session
  // is clearly climbing back, surface "Rebuilding" instead of a red "Review".
  const status =
    (baseStatus === "review" || baseStatus === "watch") && t?.trend === "recovering"
      ? "rebuilding"
      : baseStatus;
  const isAtPR = parseFloat((pct * 100).toFixed(1)) >= 100;
  const prBoost = prRatio ? Math.round(prRatio * 100) : 0;
  const isNewPR = beatsPrevBest;
  const isFirstPR = isAtPR && prRatio == null;
  const showPR = isNewPR || isFirstPR;
  const prLabel = isNewPR && prBoost > 100 ? `${prBoost}%` : "NEW";
  const label = RETENTION_LABELS[status] ?? status;
  const prFmt = !showPR ? fmtInspectorEntry(prEntry) : null;
  const prDate = !showPR ? fmtInspectorDate(prEntry.log.log_date ?? "") : null;
  const expandable = !!prFmt;
  const entries = logsAsc.map((l) => toLogEntry(l, setCount)).filter((e): e is LogEntry => e !== null);
  const reason = buildStatusReason(status, t?.trend, entries, prEntry, pct);
  const needsExplaining =
    status === "review" || status === "watch" || status === "rebuilding";

  // A new PR is a checkpoint: it already answers "improving or not?" for this
  // session, so don't also show a trend chip (e.g. "Recovering") next to it.
  // Trend resumes fresh from the next session.
  return { pct, status, showPR, prLabel, label, prFmt, prDate, expandable, reason, needsExplaining, t: showPR ? null : (t ?? null) };
}
