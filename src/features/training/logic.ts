// Pure stat functions operating on TrainingLog[] from Supabase.
// No stagnation / trend analysis — Training tab is action-only.

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

  const dw = parseFloat((cKg - pKg).toFixed(3));
  if (dw > 0) return { text: `+${Math.abs(dw)} kg` };
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
