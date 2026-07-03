// Pure stat functions operating on TrainingLog[] from Supabase.

import type { TrainingLog } from "./api";
import { parse, score } from "./parser";

export type TimeFilter = "3mo" | "year" | "all";

export interface LogEntry {
  log: TrainingLog;
  weightKg: number;
  reps: string;
  e1rm: number;
  volume: number;
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

/** Total reps across drop-set segments, e.g. "10/8/6" -> 24. */
export function sumReps(repsStr: string): number {
  return String(repsStr || "")
    .split(/[/\-]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0)
    .reduce((a, b) => a + b, 0);
}

/** Training volume (weight × total reps across all sets) — a hypertrophy-
 * oriented PR metric: doing more sets/reps at a weight counts as a bigger
 * record, unlike e1RM (which only credits the single best set). */
export function computeVolume(weightKg: number, repsStr: string): number {
  const reps = sumReps(repsStr);
  if (!reps || !weightKg || weightKg <= 0) return 0;
  return weightKg * reps;
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
    volume: computeVolume(weightKg, parsed.reps),
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

  // PR = highest training volume (weight × total reps), not e1RM — doing
  // more sets/reps at a weight is a bigger record for hypertrophy goals than
  // a single best set would suggest.
  let best = entries[0];
  let bestVolume = best.volume;
  for (const e of entries) {
    // >= (not >): entries are chronological ascending, so on a volume tie the
    // more recent entry should keep the PR badge, not whichever hit it first.
    if (e.volume >= bestVolume) {
      bestVolume = e.volume;
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
 * Compare curr vs prev entry directly by weight (kg) and reps — no e1RM.
 * Only emits a gain when neither dimension regressed and at least one
 * improved (heavier weight, or same weight for more reps): "▲ +2.5kg".
 * Mixed-direction changes (e.g. heavier but fewer reps) stay silent since
 * there's no single number to compare kg and reps against.
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
  if (!cReps || !pReps) return null;

  const kgDelta = cKg - pKg;
  const repsDelta = cReps - pReps;
  if (kgDelta < 0 || repsDelta < 0) return null; // regressed — stay silent
  if (kgDelta === 0 && repsDelta === 0) return null; // flat — stay silent

  const parts: string[] = [];
  if (kgDelta > 0) parts.push(`+${parseFloat(kgDelta.toFixed(2))}kg`);
  if (repsDelta > 0) parts.push(`+${repsDelta} reps`);

  return { text: `▲ ${parts.join(" ")}` };
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

  // Same PR metric as computeStats: highest volume, ties won by recency.
  let prVolume = 0;
  let prEntry: LogEntry | null = null;
  for (const e of entries) {
    if (e.volume >= prVolume) { prVolume = e.volume; prEntry = e; }
  }
  if (!prVolume || !prEntry) return null;

  const mostRecentDate = entries[entries.length - 1].log.log_date;
  const recent = entries.filter((e) => e.log.log_date === mostRecentDate);
  let currentVolume = 0;
  for (const e of recent) { if (e.volume > currentVolume) currentVolume = e.volume; }
  if (!currentVolume) return null;

  const pct = Math.min(currentVolume / prVolume, 1);

  let prevBestVolume = 0;
  for (const e of entries) {
    if (e.log.log_date === mostRecentDate) continue;
    if (e.volume > prevBestVolume) prevBestVolume = e.volume;
  }
  const prRatio = prevBestVolume ? currentVolume / prevBestVolume : null;

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
  const prLabel = isNewPR ? `${prBoost}%!` : "NEW PR!";
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
