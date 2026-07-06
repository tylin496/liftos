// Strength trend — the single source for the Training Health card, plus the
// Training feature's Evaluation (the derived judgment the Decision Engine reads).
//
// Extracted from overview/api.ts so the persistence path (nutrition/evaluationApi)
// can build the training slice without importing overview/api — which imports
// evaluationApi back, and that cycle is best avoided. This module depends only on
// the training parser/e1RM, nothing else.

import { parse, score } from "@features/training/parser";
import { epley1RM } from "@features/training/logic";

export type StrengthStatus = "improving" | "stable" | "watch";

export interface StrengthExercise {
  slug: string;
  name: string;
  status: StrengthStatus;
  latestE1RM: number;  // most recent session best
  prE1RM: number;      // all-time best across all sessions
  trend: number;       // latestE1RM / prE1RM — distance-from-PR ratio that drives `status`
  stalledWeeks: number; // whole weeks since the last session that set a new best
  lastLogDate: string;  // ISO date of the most recent session — for staleness labelling
}

export interface StrengthSummary {
  improving: number;
  stable: number;
  watch: number;
  total: number; // exercises with enough data
  exercises: StrengthExercise[];
}

/** Logs grouped by exercise slug — the only shape the strength computation
 *  needs. Rows may arrive in any date order (sorted internally). */
export type LogsBySlug = Record<string, Array<{ log_date: string | null; raw: string | null }>>;

/**
 * Per-exercise strength trend — the single source for the Training Health card,
 * shared by Overview (fetchOverview) and the Training tab (computed from the
 * logs it already holds). Needs ≥4 sessions per exercise to compare recent-3
 * vs prior. Pure: pass logs grouped by slug, get the summary back.
 */
export function computeStrengthSummary(logsBySlug: LogsBySlug): StrengthSummary {
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, total: 0, exercises: [] };

  for (const [slug, slugLogs] of Object.entries(logsBySlug)) {
    // Performance trend: need ≥4 logs to compare recent 3 vs prior sessions
    if (slugLogs.length < 4) continue;
    strength.total++;

    // Group by date (a day = one session), take best e1RM per date
    const byDate: Record<string, number> = {};
    for (const l of slugLogs) {
      if (!l.log_date || !l.raw) continue;
      const p = parse(l.raw);
      if (!p) continue;
      const w = score(p);
      if (!Number.isFinite(w)) continue;
      const e = epley1RM(w, p.reps);
      byDate[l.log_date] = Math.max(byDate[l.log_date] ?? 0, e);
    }
    // Sort ascending by date so recent/prior slices are correct regardless of
    // the caller's row order (Overview queries asc; the Training tab keeps logs
    // newest-first).
    const datedBests = Object.entries(byDate)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const sessionBests = datedBests.map(([, v]) => v);
    if (sessionBests.length < 4) { strength.total--; continue; }

    const latestE1RM = sessionBests[sessionBests.length - 1];
    const prE1RM = Math.max(...sessionBests);

    // Status = distance from PR, NOT recent-vs-prior slope. This user logs
    // asymmetrically — they only record a session when strength DROPS (or on a
    // PR); maintained days are left unlogged. So a recent-vs-prior slope reads
    // that biased sample as decline even while they're holding. Judging purely
    // by "how far below PR is the last recorded session" makes maintenance the
    // healthy default and only flags a genuine, meaningful drop.
    const pct = prE1RM > 0 ? latestE1RM / prE1RM : 0;
    let status: StrengthStatus;
    if (pct >= 0.997) { strength.improving++; status = "improving"; }  // at / new PR
    else if (pct >= 0.94) { strength.stable++; status = "stable"; }    // holding
    else { strength.watch++; status = "watch"; }                      // real drop below PR

    // Weeks stalled: span from the last session that set a new running best to
    // the most recent session. A rising lift lands its PR on (or near) the last
    // session → ~0; a stalled one carries weeks of no new best.
    let runningMax = -Infinity;
    let prDate = datedBests[0][0];
    for (const [date, e] of datedBests) {
      if (e > runningMax) { runningMax = e; prDate = date; }
    }
    const lastDate = datedBests[datedBests.length - 1][0];
    const stalledWeeks = Math.floor(
      (Date.parse(lastDate) - Date.parse(prDate)) / (7 * 24 * 60 * 60 * 1000),
    );

    strength.exercises.push({
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      status,
      latestE1RM,
      prE1RM,
      trend: pct,
      stalledWeeks,
      lastLogDate: lastDate,
    });
  }

  return strength;
}

// ─── Training Evaluation (the Decision Engine's training slice) ──────────────

export type TrainingTrend = "improving" | "holding" | "declining";

/** Training's derived judgment — a stable trend verdict, NOT a raw watch count.
 *  "declining" requires enough lifts sitting meaningfully below PR *for weeks*
 *  (a real, settled drop), so a single missed session or one-off dip never reads
 *  as decline (staleness is a label, not a decline). Absence of data → low
 *  confidence + "holding", so the engine treats "no info" as "no problem" rather
 *  than firing a bad-news tier. */
export interface TrainingEvaluation {
  trend: TrainingTrend;
  confidence: "low" | "medium" | "high";
  /** Lifts sitting below PR (from the summary) — surfaced for wording/debug. */
  watch: number;
  /** Lifts with enough data to judge (≥4 sessions). */
  total: number;
}

export function buildTrainingEvaluation(summary: StrengthSummary): TrainingEvaluation {
  const { improving, watch, total, exercises } = summary;
  // Fewer than two judgeable lifts → we can't claim a trend. Neutral + low
  // confidence so the engine never fires a training-dependent tier off noise.
  if (total < 2) return { trend: "holding", confidence: "low", watch, total };

  // A lift counts toward decline only when it's both below PR (watch) AND has
  // carried that gap for ≥3 weeks — a settled drop, not a fresh dip.
  const stalledWatch = exercises.filter((e) => e.status === "watch" && e.stalledWeeks >= 3).length;
  const declineThreshold = Math.max(2, Math.ceil(total / 3)); // ≥⅓ of lifts, min 2
  const confidence: TrainingEvaluation["confidence"] = total >= 4 ? "high" : "medium";

  let trend: TrainingTrend;
  if (stalledWatch >= declineThreshold) trend = "declining";
  else if (improving > total / 2 && watch === 0) trend = "improving";
  else trend = "holding";

  return { trend, confidence, watch, total };
}
