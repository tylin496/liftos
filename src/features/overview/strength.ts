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

/** A `watch` lift (latest session below 94% of PR) only counts as "needs
 *  intervention" once it's been stuck this many weeks. A recent PR on either axis
 *  (small stalledWeeks) means one lighter session isn't a plateau — so it buys a
 *  grace period. Shared by the card's Needs-Attention list, the AI export, and the
 *  Decision Engine's decline gate, so the three never disagree. */
export const ATTENTION_STALL_WEEKS = 3;

/** A recovering lift's latest session must clear its recent trough by at least
 *  this ratio (≥2%) — enough to be a real climb, not e1RM float noise. Mirrors
 *  the magnitude the PR clock already treats as meaningful. */
const RECOVERY_MIN_RATIO = 1.02;

/** Is the lift climbing back? Uses the last three LOGGED session bests (ascending):
 *  a two-step climb into the most recent session (prior ≤ mid < latest) that clears
 *  RECOVERY_MIN_RATIO off the recent trough. Trajectory is read ONLY in the benign
 *  (upward) direction — the asymmetric log biases toward drop-days, so a down-slope
 *  is untrustworthy, but a climb seen *despite* that bias is a strong signal. So
 *  this only ever rescues a lift from Needs Attention; it never flags one. */
function isRecovering(sessionBests: number[]): boolean {
  if (sessionBests.length < 3) return false;
  const [prior, mid, latest] = sessionBests.slice(-3);
  const twoStepClimb = latest > mid && mid >= prior;
  const meaningful = latest / Math.min(prior, mid) >= RECOVERY_MIN_RATIO;
  return twoStepClimb && meaningful;
}

export interface StrengthExercise {
  slug: string;
  name: string;
  status: StrengthStatus;
  latestE1RM: number;  // most recent session best
  prE1RM: number;      // all-time best across all sessions
  trend: number;       // latestE1RM / prE1RM — distance-from-PR ratio that drives `status`
  stalledWeeks: number; // whole weeks since the last PR on EITHER axis (e1RM ceiling or heaviest weight)
  lastLogDate: string;  // ISO date of the most recent session — for staleness labelling
  /** ISO date of the most recent session that SET a PR on either axis (new e1RM
   *  ceiling OR heaviest weight) — the stall clock's reset point. Powers the
   *  "fresh PR this week" snapshot line, so it counts Performance PRs too. */
  lastPRDate: string;
  /** Below PR AND stuck ≥ ATTENTION_STALL_WEEKS — the single "this lift needs
   *  intervention" predicate. A recently-PR'd watch lift is false (grace period).
   *  Also false while `recovering` (climbing back on its own → no intervention). */
  needsAttention: boolean;
  /** Below PR but the last few LOGGED sessions are climbing back — a recovery
   *  visible in the data (not inferred from silence). Suppresses needsAttention
   *  and earns a "回升中" chip; never used to FLAG a lift, only to rescue one. */
  recovering: boolean;
}

export interface StrengthSummary {
  improving: number;
  stable: number;
  watch: number;
  /** Lifts flagged for intervention = watch AND stalled ≥ ATTENTION_STALL_WEEKS.
   *  ≤ watch; a recently-PR'd watch lift is excluded. */
  attention: number;
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
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, attention: 0, total: 0, exercises: [] };

  for (const [slug, slugLogs] of Object.entries(logsBySlug)) {
    // Performance trend: need ≥4 logs to compare recent 3 vs prior sessions
    if (slugLogs.length < 4) continue;
    strength.total++;

    // Group by date (a day = one session); keep the best on BOTH axes — max e1RM
    // (the status/retention number) and max completed weight (the Performance-PR
    // axis, used only to reset the stall clock below).
    const byDate: Record<string, { e1rm: number; weightKg: number }> = {};
    for (const l of slugLogs) {
      if (!l.log_date || !l.raw) continue;
      const p = parse(l.raw);
      if (!p) continue;
      const w = score(p);
      if (!Number.isFinite(w)) continue;
      const e = epley1RM(w, p.reps);
      const cur = byDate[l.log_date] ?? { e1rm: 0, weightKg: 0 };
      byDate[l.log_date] = { e1rm: Math.max(cur.e1rm, e), weightKg: Math.max(cur.weightKg, w) };
    }
    // Sort ascending by date so recent/prior slices are correct regardless of
    // the caller's row order (Overview queries asc; the Training tab keeps logs
    // newest-first).
    const datedBests = Object.entries(byDate)
      .filter(([, v]) => v.e1rm > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const sessionBests = datedBests.map(([, v]) => v.e1rm);
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

    // Weeks stalled: span from the last session that set a PR on EITHER axis to
    // the most recent session. "Either axis" mirrors classifyPR's first two
    // branches (training/logic.ts) — a new rounded-e1RM ceiling OR a new heaviest
    // completed weight — so a heavier top set that Epley rates flat (77kg×7 ≈
    // 75kg×8, a Performance PR) still resets the clock. That keeps a lift making
    // real weight-axis progress OUT of the Decision Engine's "declining" read
    // (buildTrainingEvaluation gates decline on stalledWeeks ≥ 3). The reps-
    // tiebreak third branch needs setCount (not threaded here) and is left out —
    // see docs/PERFORMANCE-PR.md. Status/retention stay pure e1RM (above); only
    // the stall clock gains the weight axis.
    let runMaxE1 = -Infinity;
    let runMaxWeight = -Infinity;
    let prDate = datedBests[0][0];
    for (const [date, v] of datedBests) {
      const isPR =
        Math.round(v.e1rm * 10) / 10 > Math.round(runMaxE1 * 10) / 10 ||
        v.weightKg > runMaxWeight;
      if (isPR) prDate = date;
      if (v.e1rm > runMaxE1) runMaxE1 = v.e1rm;
      if (v.weightKg > runMaxWeight) runMaxWeight = v.weightKg;
    }
    const lastDate = datedBests[datedBests.length - 1][0];
    const stalledWeeks = Math.floor(
      (Date.parse(lastDate) - Date.parse(prDate)) / (7 * 24 * 60 * 60 * 1000),
    );

    // "Needs attention" gates the retention flag on the stall clock: a lift only
    // needs intervention if it's below PR AND has been stuck for weeks. A recent
    // PR on either axis (small stalledWeeks) keeps it off the list — so one
    // lighter session after a PR can't flag it. The card, the export, and the
    // Decision Engine all read this one field.
    //
    // Recovery override: a watch lift whose last few logged sessions are climbing
    // back is self-correcting — no intervention needed — so it's pulled off the
    // list too (and shown "回升中" instead). Distinct from the stall-clock grace
    // above: that covers "just PR'd", this covers "below PR but visibly climbing".
    const recovering = status === "watch" && isRecovering(sessionBests);
    const needsAttention =
      status === "watch" && stalledWeeks >= ATTENTION_STALL_WEEKS && !recovering;
    if (needsAttention) strength.attention++;

    strength.exercises.push({
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      status,
      latestE1RM,
      prE1RM,
      trend: pct,
      stalledWeeks,
      lastLogDate: lastDate,
      lastPRDate: prDate,
      needsAttention,
      recovering,
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
  const stalledWatch = exercises.filter((e) => e.needsAttention).length;
  const declineThreshold = Math.max(2, Math.ceil(total / 3)); // ≥⅓ of lifts, min 2
  const confidence: TrainingEvaluation["confidence"] = total >= 4 ? "high" : "medium";

  let trend: TrainingTrend;
  if (stalledWatch >= declineThreshold) trend = "declining";
  else if (improving > total / 2 && watch === 0) trend = "improving";
  else trend = "holding";

  return { trend, confidence, watch, total };
}
