// Strength trend — the single source for the Training Health card, plus the
// Training feature's Evaluation (the derived judgment the Decision Engine reads).
//
// Extracted from overview/api.ts so the persistence path (nutrition/evaluationApi)
// can build the training slice without importing overview/api — which imports
// evaluationApi back, and that cycle is best avoided. This module depends only on
// the training parser/e1RM, nothing else.

import { parse, score } from "@features/training/parser";
import { epley1RM, maxReps, totalReps, type ScoreMode } from "@features/training/logic";
import { milestoneReached } from "@features/training/milestone";

/** Reps for the local reps-tiebreak — NOT training/logic.ts's totalReps, which
 *  multiplies a bare number ("7") by the exercise's real set count. This module
 *  never receives set count, so a bare number is left as-is (one set); a
 *  drop-set ("8/8/8") still sums its segments. Only ever compares sessions of
 *  the SAME lift against each other, so the missing set-count expansion cancels
 *  out — but it's a genuinely different number from logic.ts's totalReps for
 *  the same reps string, so it gets its own name to avoid the two being read as
 *  interchangeable. */
function sessionReps(repsStr: string): number {
  return totalReps(repsStr, 1);
}

export type StrengthStatus = "improving" | "stable" | "watch";

export type TrendDirection = "recovering" | "stable" | "declining";

/** The trend-layer read for one lift — the trajectory of the recent LOGGED
 *  sessions, kept DISTINCT from `trend` (the distance-from-PR ratio that drives
 *  `status`). `status` answers "how far below the ceiling is the last session";
 *  this answers "which way, how fast, how sure" over the recent window. Built
 *  entirely from data the engine already holds (recentBests + session dates),
 *  and — critically — it never manufactures the untrustworthy number `status`
 *  deliberately avoids: a fuzzy regression slope over asymmetrically-logged
 *  sessions. Direction only fires off the same trusted consecutive-run
 *  predicates the flags use; velocity is 0 unless one of those runs is present. */
export interface StrengthTrajectory {
  /** Recovering/declining come from the SAME trusted consecutive-run predicates
   *  as the flags (isRecovering/isDeclining), so direction never contradicts
   *  them. "recovering" here is a superset of the `recovering` FIELD: the field
   *  is gated on `watch` (it only rescues a lift from intervention), whereas the
   *  trajectory reports a climb even when the lift is already at/near PR. */
  direction: TrendDirection;
  /** Signed per-run fractional change measured across the trusted last-3 run
   *  (+climb off the trough / −slide off the peak). Exactly 0 when direction is
   *  "stable" — we never emit a slope we don't trust. */
  velocity: number;
  /** 0..1 — how much the recent window can back the read, from the session
   *  dates alone: cadence (sessions/week) × sample depth. Sparse or shallow
   *  history reads low; a densely, deeply logged lift reads high. Recency /
   *  staleness is NOT folded in (it lives on `lastLogDate`, surfaced by the
   *  card) so it isn't double-counted here. */
  confidence: number;
}

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

/** Mirror of RECOVERY_MIN_RATIO for the down direction: the latest session must be
 *  at least this far (≥2%) below the recent high to count as a real slide. */
const DECLINE_MAX_RATIO = 0.98;

/** Is the lift sliding? The mirror of isRecovering — a two-step DOWN-run into the
 *  most recent session (prior ≥ mid > latest) clearing a ≥2% drop off the recent
 *  high. A consecutive monotonic slide is a REAL pattern in the recorded sessions
 *  (not an interpolation of unlogged days), so — unlike a fuzzy regression slope,
 *  which the asymmetric drop-day logging makes untrustworthy — it IS safe to flag.
 *  And it's acute: it flags immediately, without waiting for the stall-week gate
 *  (a live slide during a cut = likely muscle loss, the thing to catch fastest). */
function isDeclining(sessionBests: number[]): boolean {
  if (sessionBests.length < 3) return false;
  const [prior, mid, latest] = sessionBests.slice(-3);
  const twoStepSlide = latest < mid && mid <= prior;
  const meaningful = latest / Math.max(prior, mid) <= DECLINE_MAX_RATIO;
  return twoStepSlide && meaningful;
}

/** Sessions/week over the recent window that earns full cadence credit — ~once
 *  a fortnight is dense enough to trust a short-run trajectory. */
const TREND_FULL_CADENCE = 0.5;
/** Recent sessions that earn full sample-depth credit. */
const TREND_FULL_SAMPLE = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The trend-layer read for one lift. `sessionBests` (ascending mode-scores) and
 *  `windowDates` (ISO dates of the last ≤8 sessions) must be aligned — same
 *  sessions, same order. Pure and now-free: the confidence is derived from the
 *  window's own dates, never from wall-clock "now". */
export function computeTrajectory(sessionBests: number[], windowDates: string[]): StrengthTrajectory {
  const direction: TrendDirection = isDeclining(sessionBests)
    ? "declining"
    : isRecovering(sessionBests)
      ? "recovering"
      : "stable";

  // Velocity = the magnitude the direction gate already measured: the last-3 run's
  // net fractional change off its anchor (trough for a climb, peak for a slide).
  // Same quantity RECOVERY_MIN_RATIO / DECLINE_MAX_RATIO threshold on, so the two
  // can never disagree. Stable → 0 (no trusted run, no number).
  let velocity = 0;
  if (direction !== "stable" && sessionBests.length >= 3) {
    const [prior, mid, latest] = sessionBests.slice(-3);
    const anchor = direction === "recovering" ? Math.min(prior, mid) : Math.max(prior, mid);
    if (anchor > 0) velocity = Math.round((latest / anchor - 1) * 1000) / 1000;
  }

  // Confidence: how much the recent window can back the read, from its dates alone.
  //  • cadence — sessions/week; a ~weekly lift gives a dense, trustworthy line, a
  //    lift logged twice in two months does not.
  //  • sample — how many recent sessions deep the window is.
  // Cadence-led, sample modulates (a dense but shallow window still reads mid).
  const n = windowDates.length;
  const spanWeeks = Math.max(
    (Date.parse(windowDates[n - 1]) - Date.parse(windowDates[0])) / WEEK_MS,
    1e-9,
  );
  const cadenceFactor = Math.min(1, (n - 1) / spanWeeks / TREND_FULL_CADENCE);
  const sampleFactor = Math.min(1, n / TREND_FULL_SAMPLE);
  const confidence = Math.round(cadenceFactor * (0.5 + 0.5 * sampleFactor) * 100) / 100;

  return { direction, velocity, confidence };
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
   *  and earns a "Rebounding" chip; never used to FLAG a lift, only to rescue one. */
  recovering: boolean;
  /** The last few LOGGED sessions are stepping DOWN (a consecutive slide) — an
   *  acute decline visible in the data. FLAGS the lift (unlike recovering, which
   *  rescues): fires immediately, without the stall-week gate or the watch gate. */
  declining: boolean;
  /** Recent session e1RMs (ascending, up to 8) — the row's mini trend sparkline. */
  recentBests: number[];
  /** The trend-layer read (direction / velocity / confidence) over the recent
   *  window — see StrengthTrajectory. Complements `trend` (distance-from-PR):
   *  that says how far below the ceiling, this says which way and how fast. */
  trajectory: StrengthTrajectory;
  /** Which kind of PR the most recent one (at `lastPRDate`) was — drives the
   *  reward icon/label. Compound: new e1RM ceiling ("strength", 🏆) or weight-axis
   *  ("performance", 💪). Isolation: new best-set tonnage ceiling ("hypertrophy",
   *  🏆). Always set (the first-ever session PRs on its mode's ceiling axis). */
  lastPRKind: "strength" | "performance" | "hypertrophy";
  /** The PR session's heaviest set as "77 kg × 7" — the concrete detail for a
   *  Performance PR reward row. */
  lastPRDetail: string;
  /** If the most recent PR session also crossed a round-weight milestone rung
   *  (compound lifts only — see milestone.ts), the rung in kg. The persisted
   *  look-back counterpart to ExerciseCard's log-time 🎯 toast, so the Training
   *  Health card can show a gold "🎯 180 kg" chip on the reward row. Undefined
   *  when the caller supplied no compound flags, the lift isn't compound, or no
   *  new rung was crossed. */
  milestoneKg?: number;
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
export function computeStrengthSummary(
  logsBySlug: LogsBySlug,
  /** Slugs flagged `exercises.compound` — only these earn a round-weight
   *  milestone (machine isolations load heavy and would spam rungs; see
   *  milestone.ts). Optional: callers that don't render the reward chip (the
   *  Decision Engine slice, the data export) omit it and no milestone is set. */
  compoundSlugs?: Set<string>,
  /** slug → the exercise's real stored name (e.g. "RDL", not the derived
   *  "Rdl"). Optional: callers without the exercise list handy fall back to
   *  title-casing the slug, which is only an approximation — it can't recover
   *  intentional casing like an acronym. */
  namesBySlug?: Record<string, string>,
): StrengthSummary {
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, attention: 0, total: 0, exercises: [] };

  for (const [slug, slugLogs] of Object.entries(logsBySlug)) {
    // Performance trend: need ≥4 logs to compare recent 3 vs prior sessions
    if (slugLogs.length < 4) continue;
    strength.total++;

    // Two separate concerns keyed off `compoundSlugs`:
    //  • Score mode — compound → e1RM (heavy/low-rep is the goal); isolation →
    //    best-set tonnage (weight × reps), which holds when load is traded for
    //    reps, so a deliberate rep-target change isn't misread as a regression.
    //    An OMITTED set = a legacy caller that doesn't split → judge on e1RM (the
    //    pre-tonnage behavior). A PROVIDED set is authoritative: members compound,
    //    everything else isolation. Mirrors logic.ts's ScoreMode so the card and
    //    the log-time toast never disagree.
    //  • Milestone gate — `isCompound` stays explicit-membership-only (a round-
    //    weight rung is compound-only, and absence must not spam rungs).
    const inCompoundSet = compoundSlugs?.has(slug) ?? false;
    const mode: ScoreMode = compoundSlugs ? (inCompoundSet ? "compound" : "isolation") : "compound";
    const isCompound = inCompoundSet;

    // Group by date (a day = one session); keep the best on every axis — max e1RM,
    // max best-set tonnage (the two candidate score axes), and max completed weight
    // (the compound Performance-PR axis, used only to reset the stall clock below).
    const byDate: Record<string, { e1rm: number; tonnage: number; weightKg: number; topReps: number; ceilingReps: number }> = {};
    for (const l of slugLogs) {
      if (!l.log_date || !l.raw) continue;
      const p = parse(l.raw);
      if (!p) continue;
      const w = score(p);
      if (!Number.isFinite(w)) continue;
      const e = epley1RM(w, p.reps);
      const tng = w > 0 ? w * maxReps(p.reps) : 0; // uncapped reps — matches logic.ts toLogEntry
      const tr = sessionReps(p.reps);
      const cur = byDate[l.log_date] ?? { e1rm: 0, tonnage: 0, weightKg: 0, topReps: 0, ceilingReps: 0 };
      const heavier = w > cur.weightKg; // track reps of the HEAVIEST set (the PR detail)
      // Round to the same 1-decimal precision the PR loop below compares at
      // (roundedE1) — a raw-float tie check here could split what that loop
      // treats as one ceiling into two, silently dropping the earlier set's reps.
      const eR = Math.round(e * 10) / 10;
      const curE1R = Math.round(cur.e1rm * 10) / 10;
      byDate[l.log_date] = {
        e1rm: Math.max(cur.e1rm, e),
        tonnage: Math.max(cur.tonnage, tng),
        weightKg: heavier ? w : cur.weightKg,
        topReps: heavier ? maxReps(p.reps) : cur.topReps,
        // Total reps of the set that hit the day's e1RM ceiling — the reps-tiebreak
        // axis. A higher-e1RM set takes over; a tie keeps the larger rep total.
        ceilingReps: eR > curE1R ? tr : eR === curE1R ? Math.max(cur.ceilingReps, tr) : cur.ceilingReps,
      };
    }
    // Sort ascending by date so recent/prior slices are correct regardless of
    // the caller's row order (Overview queries asc; the Training tab keeps logs
    // newest-first).
    const datedBests = Object.entries(byDate)
      .filter(([, v]) => v.e1rm > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    // The score axis per mode: e1RM (compound) or best-set tonnage (isolation).
    // Everything below — retention, status, the PR clock's ceiling — reads this
    // one series, so switching the mode switches the whole verdict coherently.
    const scoreOf = (v: { e1rm: number; tonnage: number }) => (mode === "isolation" ? v.tonnage : v.e1rm);
    const sessionBests = datedBests.map(([, v]) => scoreOf(v));
    if (sessionBests.length < 4) { strength.total--; continue; }

    // latestE1RM / prE1RM carry the mode's SCORE (e1RM or tonnage) — the field
    // names predate the isolation axis; the values are always the right yardstick.
    const latestE1RM = sessionBests[sessionBests.length - 1];
    const prE1RM = Math.max(...sessionBests);

    // Status = distance from PR, NOT recent-vs-prior slope. This user logs
    // asymmetrically — they only record a session when strength DROPS (or on a
    // PR); maintained days are left unlogged. So a recent-vs-prior slope reads
    // that biased sample as decline even while they're holding. Judging purely
    // by "how far below PR is the last recorded session" makes maintenance the
    // healthy default and only flags a genuine, meaningful drop.
    // Cutoffs (product judgment, not outcome-calibrated):
    //  0.997 → "at PR": within 0.3% of the ceiling — smaller than the lightest
    //    plate you can add (a 0.5 kg microplate on a 100 kg lift is 0.5%), so the
    //    gap is below the resolution of the barbell and reads as a tie/new PR.
    //  0.94  → "holding" floor: a ~6% drop off PR, comfortably outside the ±2%
    //    e1RM noise band (RECOVERY_MIN_RATIO) — roughly a genuine set regression
    //    (a lost rep or one increment down), not float scatter. Below it = "watch".
    const pct = prE1RM > 0 ? latestE1RM / prE1RM : 0;
    let status: StrengthStatus;
    if (pct >= 0.997) { strength.improving++; status = "improving"; }  // at / new PR
    else if (pct >= 0.94) { strength.stable++; status = "stable"; }    // holding
    else { strength.watch++; status = "watch"; }                      // real drop below PR

    // Weeks stalled: span from the last session that set a PR on the mode's axes
    // to the most recent session. Mirrors classifyPR (training/logic.ts): compound
    // resets on a new rounded-e1RM ceiling (strength), a new heaviest completed
    // weight, OR — at a TIED ceiling — more total reps (the Performance reps
    // tiebreak); isolation resets on a new best-set tonnage ceiling (a single
    // Hypertrophy PR — one metric, one celebration). A reset keeps a lift making
    // real progress OUT of the Decision Engine's "declining" read (decline gates
    // on stalledWeeks ≥ 3). Reads the same `scoreOf` series as status/retention.
    let runMaxScore = -Infinity; // ceiling on the mode's score axis (e1RM or tonnage)
    let runMaxWeight = -Infinity;
    let runMaxCeilingReps = -Infinity; // most total reps seen AT the current e1RM ceiling (compound)
    let prDate = datedBests[0][0];
    // First-ever session PRs on its mode's ceiling axis.
    let lastPRKind: StrengthExercise["lastPRKind"] = mode === "isolation" ? "hypertrophy" : "strength";
    // Round-weight milestone crossed at the LAST PR session (compound only). Set
    // alongside prDate/lastPRKind so it always describes the reward row's PR, not
    // an earlier one. runMaxWeight here still holds the heaviest weight from PRIOR
    // sessions (it's updated below the check) — exactly milestoneReached's prevBest.
    let lastPRMilestone: number | null = null;
    for (const [date, v] of datedBests) {
      const scoreVal = scoreOf(v);
      const newCeiling = Math.round(scoreVal * 10) / 10 > Math.round(runMaxScore * 10) / 10;
      if (mode === "isolation") {
        // Single-tier: a new tonnage ceiling is THE Hypertrophy PR. (Tied-tonnage
        // weight/reps tiebreaks that cmpStrength would honour are negligibly rare;
        // the ceiling is the event, and it never crosses a compound milestone.)
        if (newCeiling) { prDate = date; lastPRMilestone = null; }
      } else {
        const newWeight = v.weightKg > runMaxWeight;
        // Reps tiebreak: at a TIED e1RM ceiling, beating the most total reps ever
        // done at that ceiling is a Performance PR too — resets the clock.
        const tiedCeiling = !newCeiling && Math.round(scoreVal * 10) / 10 === Math.round(runMaxScore * 10) / 10;
        const newReps = tiedCeiling && v.ceilingReps > runMaxCeilingReps;
        if (newCeiling || newWeight || newReps) {
          prDate = date;
          lastPRKind = newCeiling ? "strength" : "performance";
          lastPRMilestone = isCompound ? milestoneReached(v.weightKg, runMaxWeight) : null;
        }
        // Track the running ceiling reps: a new ceiling adopts this session's reps;
        // a tie keeps the max. (runMaxScore stays the raw max, as before.)
        if (newCeiling) runMaxCeilingReps = v.ceilingReps;
        else if (tiedCeiling) runMaxCeilingReps = Math.max(runMaxCeilingReps, v.ceilingReps);
      }
      if (scoreVal > runMaxScore) runMaxScore = scoreVal;
      if (v.weightKg > runMaxWeight) runMaxWeight = v.weightKg;
    }
    const lastDate = datedBests[datedBests.length - 1][0];
    const stalledWeeks = Math.floor(
      (Date.parse(lastDate) - Date.parse(prDate)) / (7 * 24 * 60 * 60 * 1000),
    );
    const prBest = byDate[prDate];
    const lastPRDetail = prBest ? `${Math.round(prBest.weightKg * 10) / 10} kg × ${prBest.topReps}` : "";

    // "Needs attention" gates the retention flag on the stall clock: a lift only
    // needs intervention if it's below PR AND has been stuck for weeks. A recent
    // PR on either axis (small stalledWeeks) keeps it off the list — so one
    // lighter session after a PR can't flag it. The card, the export, and the
    // Decision Engine all read this one field.
    //
    // Recovery override: a watch lift whose last few logged sessions are climbing
    // back is self-correcting — no intervention needed — so it's pulled off the
    // list too (and shown "Rebounding" instead). Distinct from the stall-clock grace
    // above: that covers "just PR'd", this covers "below PR but visibly climbing".
    const recovering = status === "watch" && isRecovering(sessionBests);
    // Acute decline: a consecutive down-run in the logged sessions. Flags on its
    // own — NOT gated on `watch` or the stall-week clock — because a live slide
    // (e.g. losing strength mid-cut) is urgent even a few % below peak. Mirror of
    // `recovering`: same trusted consecutive-run logic, opposite direction.
    const declining = isDeclining(sessionBests);
    // Trajectory reads the SAME recent window as recentBests (last ≤8 sessions),
    // aligned to their dates so confidence reflects the exact data it summarises.
    const windowDates = datedBests.slice(-8).map(([d]) => d);
    const trajectory = computeTrajectory(sessionBests, windowDates);
    const needsAttention =
      declining ||
      (status === "watch" && stalledWeeks >= ATTENTION_STALL_WEEKS && !recovering);
    if (needsAttention) strength.attention++;

    strength.exercises.push({
      slug,
      name: namesBySlug?.[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      status,
      latestE1RM,
      prE1RM,
      trend: pct,
      stalledWeeks,
      lastLogDate: lastDate,
      lastPRDate: prDate,
      needsAttention,
      recovering,
      declining,
      recentBests: sessionBests.slice(-8),
      trajectory,
      lastPRKind,
      lastPRDetail,
      milestoneKg: lastPRMilestone ?? undefined,
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
  // "improving" needs a majority PRing AND no lift that actually needs
  // intervention. Gating on stalledWatch (needsAttention) rather than raw `watch`
  // is a real-data calibration fix: a strong block almost always carries 1–2
  // lagging lifts that are either fresh off a PR (grace window) or visibly
  // rebounding — neither is a problem, so neither should veto the whole-body
  // "improving" read. Only a settled stall or an acute slide should. (Export
  // check 2026-07: 8/11 lifts PRing with the only watch lifts being a just-PR'd
  // Assisted Pull-up + a rebounding Leg Curl — old `watch === 0` mislabelled it.)
  else if (improving > total / 2 && stalledWatch === 0) trend = "improving";
  else trend = "holding";

  return { trend, confidence, watch, total };
}
