// Pure stat functions operating on TrainingLog[] from Supabase.

import type { TrainingLog } from "./api";
import { parse, score, totalReps } from "./parser";

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

export function epley1RM(weightKg: number, repsStr: string): number {
  const segs = String(repsStr || "")
    .split(/[/\-]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  const maxR = segs.length ? Math.max(...segs) : 0;
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

  let best = entries[0];
  let bestE1RM = best.e1rm;
  for (const e of entries) {
    if (e.e1rm > bestE1RM) {
      bestE1RM = e.e1rm;
      best = e;
    }
  }

  const prIndex = logs.indexOf(best.log);
  const latest = entries[entries.length - 1];
  return { best, prIndex, latest };
}

// ─── computeHistDelta ────────────────────────────────────────────────────────

export interface HistDelta {
  text: string;
}

/**
 * Compare curr vs prev entry. Only emit positive gains:
 * - weight gain: "+2.5 kg"
 * - rep gain (same weight, ≥2 more total reps): "+N reps"
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

  const dw = parseFloat((cKg - pKg).toFixed(2));
  if (dw > 0) return { text: `+${parseFloat(Math.abs(dw).toFixed(2))} kg` };
  if (dw !== 0) return null; // weight dropped — stay silent

  // Rep fallback: only when same set count
  const cSegs = String(cp.reps || "").split(/[/\-]/);
  const pSegs = String(pp.reps || "").split(/[/\-]/);
  if (cSegs.length !== pSegs.length) return null;

  const cTotal = cSegs.reduce((a, s) => a + (parseInt(s, 10) || 0), 0);
  const pTotal = pSegs.reduce((a, s) => a + (parseInt(s, 10) || 0), 0);
  const dr = cTotal - pTotal;
  if (dr < 2) return null;

  return { text: `+${dr} reps` };
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

// ─── re-export totalReps for convenience ─────────────────────────────────────
export { totalReps };

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

  let prE1RM = 0;
  let prEntry: LogEntry | null = null;
  for (const e of entries) {
    if (e.e1rm > prE1RM) { prE1RM = e.e1rm; prEntry = e; }
  }
  if (!prE1RM || !prEntry) return null;

  const mostRecentDate = entries[entries.length - 1].log.log_date;
  const recent = entries.filter((e) => e.log.log_date === mostRecentDate);
  let currentE1RM = 0;
  for (const e of recent) { if (e.e1rm > currentE1RM) currentE1RM = e.e1rm; }
  if (!currentE1RM) return null;

  const pct = Math.min(currentE1RM / prE1RM, 1);

  let prevBestE1RM = 0;
  for (const e of entries) {
    if (e.log.log_date === mostRecentDate) continue;
    if (e.e1rm > prevBestE1RM) prevBestE1RM = e.e1rm;
  }
  const prRatio = prevBestE1RM ? currentE1RM / prevBestE1RM : null;

  let status: RetentionStatus;
  if (pct >= 0.97) status = "excellent";
  else if (pct >= 0.94) status = "on-track";
  else if (pct >= 0.90) status = "watch";
  else status = "review";

  return { pct, status, prEntry, prRatio };
}

function computeTrend(logsAsc: TrainingLog[]): TrendResult | null {
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
  const refIdx = sessions.length >= 3 ? sessions.length - 3 : sessions.length - 2;
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
): string | null {
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
  if (status === "on-track") return "Within retention target";
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
};

/** Pass ALL logs (not time-filtered) so the badge reflects the all-time PR. */
export function buildStagnationView(logsAsc: TrainingLog[]): StagnationView | null {
  const s = computeStrengthRetention(logsAsc);
  const t = computeTrend(logsAsc);
  if (!s) return null;

  const { pct, status, prEntry, prRatio } = s;
  const isAtPR = parseFloat((pct * 100).toFixed(1)) >= 100;
  const prBoost = prRatio ? Math.round(prRatio * 100) : 0;
  const isNewPR = prBoost > 100;
  const isFirstPR = isAtPR && prRatio == null;
  const showPR = isNewPR || isFirstPR;
  const prLabel = isNewPR ? `${prBoost}% PR!` : "NEW PR!";
  const label = RETENTION_LABELS[status] ?? status;
  const prFmt = !showPR ? fmtInspectorEntry(prEntry) : null;
  const prDate = !showPR ? fmtInspectorDate(prEntry.log.log_date ?? "") : null;
  const expandable = !!prFmt;
  const entries = logsAsc.map(toLogEntry).filter((e): e is LogEntry => e !== null);
  const reason = buildStatusReason(status, t?.trend, entries, prEntry);
  const needsExplaining = status === "review" || status === "watch";

  return { pct, status, showPR, prLabel, label, prFmt, prDate, expandable, reason, needsExplaining, t: t ?? null };
}
