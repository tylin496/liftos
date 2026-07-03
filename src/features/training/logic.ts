// Pure stat functions operating on TrainingLog[] from Supabase.

import type { TrainingLog } from "./api";
import { parse, score } from "./parser";

export type TimeFilter = "3mo" | "year" | "all";

export interface LogEntry {
  log: TrainingLog;
  weightKg: number;
  reps: string;
  e1rm: number;
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

export function epley1RM(weightKg: number, repsStr: string): number {
  const maxR = maxReps(repsStr);
  if (!maxR || !weightKg || weightKg <= 0) return 0;
  return weightKg * (1 + maxR / 30);
}

// ─── toLogEntry ──────────────────────────────────────────────────────────────

export function toLogEntry(log: TrainingLog): LogEntry | null {
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
  };
}

/**
 * "Which set is stronger" — the single ordering the whole training tab uses for
 * PRs, status, and history deltas, so the badge and the trend never disagree.
 * Hybrid: estimated 1RM first (Epley folds weight × reps into one number, so a
 * heavier-but-fewer vs lighter-but-more tradeoff resolves cleanly); on an e1RM
 * tie, more max-reps wins; a full tie returns 0 and the caller keeps whoever
 * came first. Returns >0 when `a` beats `b`, <0 when weaker, 0 when equal.
 */
export function cmpStrength(a: LogEntry, b: LogEntry): number {
  if (a.e1rm !== b.e1rm) return a.e1rm - b.e1rm;
  return maxReps(a.reps) - maxReps(b.reps);
}

// ─── computeStats ────────────────────────────────────────────────────────────

export interface Stats {
  best: LogEntry | null;
  prIndex: number; // index in filtered logs array (sorted by date asc)
  latest: LogEntry | null;
}

/** logs should be sorted chronological ascending (oldest first). */
export function computeStats(logs: TrainingLog[]): Stats {
  const entries = logs.map(toLogEntry).filter((e): e is LogEntry => e !== null);
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
 * Compare curr vs prev entry. Direction follows the same cmpStrength ordering
 * as PRs/status: estimated 1RM first (which folds a heavier-but-fewer vs
 * lighter-but-more tradeoff into one number), then max reps on an e1RM tie.
 * The label still spells out the raw kg / reps change so the user sees what
 * actually moved.
 */
export function computeHistDelta(
  curr: TrainingLog,
  prev: TrainingLog,
): HistDelta | null {
  if (!curr.raw || !prev.raw) return null;
  const cp = parse(curr.raw);
  const pp = parse(prev.raw);
  if (!cp || !pp) return null;

  const cKg = score(cp);
  const pKg = score(pp);
  if (!Number.isFinite(cKg) || !Number.isFinite(pKg)) return null;

  const cReps = maxReps(cp.reps);
  const pReps = maxReps(pp.reps);

  const kgDelta = cKg - pKg;
  const repsDelta = cReps - pReps;

  const cE1 = epley1RM(cKg, cp.reps);
  const pE1 = epley1RM(pKg, pp.reps);
  let direction: "gain" | "loss";
  if (cE1 !== pE1) {
    direction = cE1 > pE1 ? "gain" : "loss";
  } else if (repsDelta !== 0) {
    direction = repsDelta > 0 ? "gain" : "loss";
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

function computeStrengthRetention(logsAsc: TrainingLog[]) {
  const entries = logsAsc.map(toLogEntry).filter((e): e is LogEntry => e !== null);
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

  let status: RetentionStatus;
  if (pct >= 0.97) status = "excellent";
  else if (pct >= 0.94) status = "on-track";
  else if (pct >= 0.90) status = "watch";
  else status = "review";

  return { pct, status, prEntry, prRatio };
}

export function computeTrend(logsAsc: TrainingLog[]): TrendResult | null {
  const entries = logsAsc.map(toLogEntry).filter((e): e is LogEntry => e !== null);
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
export function buildStagnationView(logsAsc: TrainingLog[]): StagnationView | null {
  const s = computeStrengthRetention(logsAsc);
  const t = computeTrend(logsAsc);
  if (!s) return null;

  const { pct, status: baseStatus, prEntry, prRatio } = s;
  // Direction beats distance-from-PR: if you're below PR but the latest session
  // is clearly climbing back, surface "Rebuilding" instead of a red "Review".
  const status =
    (baseStatus === "review" || baseStatus === "watch") && t?.trend === "recovering"
      ? "rebuilding"
      : baseStatus;
  const isAtPR = parseFloat((pct * 100).toFixed(1)) >= 100;
  const prBoost = prRatio ? Math.round(prRatio * 100) : 0;
  const isNewPR = prBoost > 100;
  const isFirstPR = isAtPR && prRatio == null;
  const showPR = isNewPR || isFirstPR;
  const prLabel = isNewPR ? `${prBoost}%` : "NEW";
  const label = RETENTION_LABELS[status] ?? status;
  const prFmt = !showPR ? fmtInspectorEntry(prEntry) : null;
  const prDate = !showPR ? fmtInspectorDate(prEntry.log.log_date ?? "") : null;
  const expandable = !!prFmt;
  const entries = logsAsc.map(toLogEntry).filter((e): e is LogEntry => e !== null);
  const reason = buildStatusReason(status, t?.trend, entries, prEntry, pct);
  const needsExplaining =
    status === "review" || status === "watch" || status === "rebuilding";

  return { pct, status, showPR, prLabel, label, prFmt, prDate, expandable, reason, needsExplaining, t: t ?? null };
}
