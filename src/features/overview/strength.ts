// Strength trend — the single source for the Training Health card, plus the
// Training feature's Evaluation (the derived judgment the Decision Engine reads).
//
// Extracted from overview/api.ts so the persistence path (nutrition/evaluationApi)
// can build the training slice without importing overview/api — which imports
// evaluationApi back, and that cycle is best avoided. This module depends only on
// the training parser/e1RM plus the shared freshness table, nothing else.

import { parse, score } from "@features/training/parser";
import { strengthScore, maxReps, totalReps, scoreWeight, type ScoreMode } from "@features/training/logic";
import { milestoneReached } from "@features/training/milestone";
import { isStale, daysSince } from "@shared/lib/freshness";

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

/** Reps drop-off across ONE session's top set: how far the last set fell off the
 *  first, as a fraction ("16/13" → 0.19). This is the only place the per-set
 *  detail survives — every other axis in this module runs the reps string through
 *  maxReps/totalReps, which collapse it to one number and lose exactly the shape
 *  that says whether the session was submaximal or a wall.
 *
 *  null when the session can't say: a bare "8" is the log form's shorthand for the
 *  same reps across every set (no drop recorded), and a single logged set has
 *  nothing to fall off from. Null means UNKNOWN and must never be read as 0.
 *  Ascending segments clamp to 0 rather than going negative. */
function repsDropOff(repsStr: string): number | null {
  const segs = String(repsStr || "")
    .split(/[/\-]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => n > 0);
  if (segs.length < 2 || segs[0] <= 0) return null;
  return Math.max(0, 1 - segs[segs.length - 1] / segs[0]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
interface StrengthTrajectory {
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
const ATTENTION_STALL_WEEKS = 3;

/** A stall this old (and still stable) stops demanding attention: after ~3 months
 *  below peak with no decline, the hold IS the lift's current baseline — repeating
 *  "stalled N wks" every week is noise, not signal (maintenance = success). The
 *  lift demotes to `settled`: a neutral below-best fact, off the intervention
 *  list. Any acute decline re-flags it immediately (`declining` bypasses this). */
const SETTLED_STALL_WEEKS = 12;

/** A recovering lift's latest session must clear its recent trough by at least
 *  this ratio (≥2%) — enough to be a real climb, not e1RM float noise. Mirrors
 *  the magnitude the PR clock already treats as meaningful. */
const RECOVERY_MIN_RATIO = 1.02;

/** Is the lift climbing back? Uses the last three LOGGED session bests (ascending):
 *  the most recent session must be the run's high (above BOTH earlier sessions)
 *  and clear RECOVERY_MIN_RATIO off the recent trough. A strict two-step climb
 *  (prior ≤ mid < latest) was the original gate, but it never fires for lifters
 *  who wave loads — an interleaved light day (60→70→60→80) breaks the monotone
 *  run forever — so a light-day dip in the middle is tolerated. Trajectory is
 *  read ONLY in the benign (upward) direction — the asymmetric log biases toward
 *  drop-days, so a down-slope is untrustworthy, but a climb seen *despite* that
 *  bias is a strong signal. So this only ever rescues a lift from Needs
 *  Attention; it never flags one, and a single good day that flips it is
 *  self-correcting next session. */
function isRecovering(sessionBests: number[]): boolean {
  if (sessionBests.length < 3) return false;
  const [prior, mid, latest] = sessionBests.slice(-3);
  const climbToHigh = latest > mid && latest > prior;
  const meaningful = latest / Math.min(prior, mid) >= RECOVERY_MIN_RATIO;
  return climbToHigh && meaningful;
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
function computeTrajectory(sessionBests: number[], windowDates: string[]): StrengthTrajectory {
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
  latestE1RM: number;  // best of the last 3 sessions (retention numerator; name predates the window)
  prE1RM: number;      // all-time best across all sessions
  trend: number;       // latestE1RM / prE1RM — distance-from-PR ratio that drives `status`
  stalledWeeks: number; // whole weeks since the lift was last AT its ceiling — a PR on either axis OR a plain tie
  lastLogDate: string;  // ISO date of the most recent session — for staleness labelling
  /** ISO date of the most recent session that SET a PR on either axis (new e1RM
   *  ceiling OR heaviest weight) — the stall clock's reset point. Powers the
   *  "fresh PR this week" snapshot line, so it counts Performance PRs too. */
  lastPRDate: string;
  /** Below PR AND stuck ≥ ATTENTION_STALL_WEEKS — the single "this lift needs
   *  intervention" predicate. A recently-PR'd watch lift is false (grace period).
   *  Also false while `recovering` (climbing back on its own → no intervention),
   *  and false once the stall has `settled` (aged past SETTLED_STALL_WEEKS while
   *  stable — the flag expires rather than nagging forever). */
  needsAttention: boolean;
  /** Below PR, stable, and stalled ≥ SETTLED_STALL_WEEKS — a chronic stall
   *  accepted as the lift's current baseline. A neutral fact ("holding below
   *  best"), NOT a flag: it exists so the UI/export can still state the gap
   *  without keeping the lift on the intervention list. Mutually exclusive with
   *  `needsAttention`; any acute `declining` run re-flags immediately. */
  settled: boolean;
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
  /** How far the LATEST session's top set fell off within itself (see
   *  repsDropOff) — the one read of intra-session fatigue, i.e. whether that
   *  session was submaximal or a wall. null = the session logged no per-set reps,
   *  which is UNKNOWN, not "no drop-off". */
  dropOff: number | null;
  /** This lift's own median drop-off across the earlier sessions in the window —
   *  the yardstick `dropOff` is only ever meaningful against. null when no earlier
   *  session recorded per-set reps (no norm → no verdict). */
  dropOffBaseline: number | null;
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
   *  ≤ watch; a recently-PR'd watch lift is excluded, as is a `settled` one
   *  (stall aged past SETTLED_STALL_WEEKS while stable). */
  attention: number;
  total: number; // exercises with enough data
  exercises: StrengthExercise[];
  /** Aggregate card health — mean per-lift retention (latest ÷ PR), 0–100, or
   *  null when no lift qualifies. The single source for the hero % and the
   *  trend delta (both the card and the export read this, never re-derive it). */
  healthPct: number | null;
  /** Health-% change vs ~1 month ago: `delta` is the whole-point magnitude,
   *  `dir` its sign (a <1-point move reads "flat"). Null when there isn't a
   *  comparable past snapshot. Drives the "↑2%" trend chip + the subline suffix. */
  healthTrend: { delta: number; dir: "up" | "down" | "flat" } | null;
  /** Most recent logged session date across ALL lifts (including ones with too
   *  few sessions to judge) — "when did you last train", not "when was the last
   *  judgeable session". The recency the Decision Engine's training verdict is
   *  gated on; null when nothing is logged at all. */
  lastLogDate: string | null;
}

/** One lift's retention (latest ÷ all-time PR) — the atom under both the hero %
 *  and the trend delta. */
function retentionOf(e: StrengthExercise): number {
  return e.prE1RM > 0 ? e.latestE1RM / e.prE1RM : 0;
}

/** Aggregate card health = mean per-lift retention, rounded to a whole %, or
 *  null when no lift qualifies. Pure; the hero number and the month-ago trend
 *  both go through here so they can never disagree. */
function healthPct(exercises: StrengthExercise[]): number | null {
  if (exercises.length === 0) return null;
  const mean = exercises.reduce((s, e) => s + retentionOf(e), 0) / exercises.length;
  return Math.round(mean * 100);
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
  /** Internal recursion guard: the month-ago re-run passes false so it doesn't
   *  compute a trend-of-a-trend (and can't recurse forever). Callers omit it. */
  computeTrend = true,
  /** Slugs flagged `exercises.assisted` — their score axis is %BW (see
   *  scoreWeight). Authoritative when provided: a member scores %BW, everything
   *  else kg, regardless of a stray per-log assist syntax. OMITTED = legacy
   *  behaviour (decide per-log by whether the raw parsed as assisted). */
  assistedSlugs?: Set<string>,
): StrengthSummary {
  const strength: StrengthSummary = { improving: 0, stable: 0, watch: 0, attention: 0, total: 0, exercises: [], healthPct: null, healthTrend: null, lastLogDate: latestLogDate(logsBySlug) };

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
    // Score-axis unit, authoritative from the exercise's assisted_mode when the
    // set is provided; else fall back to per-log detection (legacy callers).
    const slugAssisted = assistedSlugs?.has(slug);

    // Group by date (a day = one session); keep the best on every axis — max e1RM,
    // max best-set tonnage (the two candidate score axes), and max completed weight
    // (the compound Performance-PR axis, used only to reset the stall clock below).
    const byDate: Record<string, { e1rm: number; tonnage: number; weightKg: number; scoreW: number; topReps: number; ceilingReps: number; dropOff: number | null }> = {};
    // Assisted lifts read the PR detail in %BW (scoreWeight), not raw kg — the raw
    // net kg is contaminated by bodyweight, the exact thing the %BW axis strips out.
    let isAssisted = slugAssisted ?? false;
    for (const l of slugLogs) {
      if (!l.log_date || !l.raw) continue;
      const p = parse(l.raw);
      if (!p) continue;
      const w = score(p);
      if (!Number.isFinite(w)) continue;
      // Score axes on scoreWeight (%BW for an assisted-mode exercise — a lighter
      // body must not read as a strength loss); weightKg stays real kg for the PR
      // detail and milestone rungs. Matches logic.ts toLogEntry — including
      // dropping a non-assisted log from an assisted exercise's %BW axis (sw NaN).
      const assistedMode = slugAssisted ?? !!p.assisted;
      const sw = scoreWeight(p, assistedMode);
      if (!Number.isFinite(sw)) continue;
      if (slugAssisted === undefined && p.assisted) isAssisted = true;
      // strengthScore, not epley1RM: an assisted lift's axis is plain %BW —
      // projecting Epley above the 100%-BW ceiling re-creates the phantom
      // "decline" on rep changes that logic.ts/toLogEntry already strips.
      const e = strengthScore(sw, p.reps, assistedMode);
      const tng = sw > 0 ? sw * maxReps(p.reps) : 0; // uncapped reps — matches logic.ts toLogEntry
      const tr = sessionReps(p.reps);
      const cur = byDate[l.log_date] ?? { e1rm: 0, tonnage: 0, weightKg: 0, scoreW: 0, topReps: 0, ceilingReps: 0, dropOff: null };
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
        scoreW: heavier ? sw : cur.scoreW, // %BW of the heaviest set — the assisted PR detail
        topReps: heavier ? maxReps(p.reps) : cur.topReps,
        // Total reps of the set that hit the day's e1RM ceiling — the reps-tiebreak
        // axis. A higher-e1RM set takes over; a tie keeps the larger rep total.
        ceilingReps: eR > curE1R ? tr : eR === curE1R ? Math.max(cur.ceilingReps, tr) : cur.ceilingReps,
        // Drop-off belongs to the day's HEAVIEST set — same set topReps/scoreW
        // describe. A back-off or accessory set falling apart says nothing about
        // whether the top set was at the limit.
        dropOff: heavier ? repsDropOff(p.reps) : cur.dropOff,
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
    // The numerator is the best of the last 3 logged sessions, not the latest
    // alone: a lift that touched its ceiling within the recent window IS at its
    // ceiling — one lighter rep-scheme day right after can't flip it to "watch"
    // (single-session noise), while a real drop still shows once all 3 recent
    // sessions sit below peak. The anchor stays all-time best, deliberately.
    const latestE1RM = Math.max(...sessionBests.slice(-3));
    const prE1RM = Math.max(...sessionBests);

    // Status = distance from PR, NOT recent-vs-prior slope. This user logs
    // asymmetrically — they only record a session when strength DROPS (or on a
    // PR); maintained days are left unlogged. So a recent-vs-prior slope reads
    // that biased sample as decline even while they're holding. Judging purely
    // by "how far below PR the recent window sits" makes maintenance the
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

    // Weeks stalled: span from the last session AT the ceiling (a PR on the
    // mode's axes, or a plain tie of it — see peakDate) to the most recent
    // session. PR detection mirrors classifyPR (training/logic.ts): compound
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
    // Stall clock anchor — the last session AT the ceiling, PR or not. A tied
    // ceiling (same rounded score, no new axis) is not a PR — no celebration,
    // prDate stays put — but it proves the capability is still there, so it
    // resets the clock: "stalled" means "hasn't come back to their best", not
    // "hasn't exceeded it". Always ≥ prDate (every PR is also an at-peak visit).
    let peakDate = datedBests[0][0];
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
      const tiedCeiling = !newCeiling && Math.round(scoreVal * 10) / 10 === Math.round(runMaxScore * 10) / 10;
      if (mode === "isolation") {
        // Single-tier: a new tonnage ceiling is THE Hypertrophy PR. (Tied-tonnage
        // weight/reps tiebreaks that cmpStrength would honour are negligibly rare;
        // the ceiling is the event, and it never crosses a compound milestone.)
        if (newCeiling) { prDate = date; lastPRMilestone = null; }
      } else {
        const newWeight = v.weightKg > runMaxWeight;
        // Reps tiebreak: at a TIED e1RM ceiling, beating the most total reps ever
        // done at that ceiling is a Performance PR too — resets the clock.
        const newReps = tiedCeiling && v.ceilingReps > runMaxCeilingReps;
        if (newCeiling || newWeight || newReps) {
          prDate = date;
          lastPRKind = newCeiling ? "strength" : "performance";
          // Round-weight rungs are barbell kg math; an assisted lift's net kg is
          // bodyweight-contaminated (and it has no %BW rung scheme), so — like
          // machine isolations — it never fires a kg milestone.
          lastPRMilestone = isCompound && !isAssisted ? milestoneReached(v.weightKg, runMaxWeight) : null;
        }
        // Track the running ceiling reps: a new ceiling adopts this session's reps;
        // a tie keeps the max. (runMaxScore stays the raw max, as before.)
        if (newCeiling) runMaxCeilingReps = v.ceilingReps;
        else if (tiedCeiling) runMaxCeilingReps = Math.max(runMaxCeilingReps, v.ceilingReps);
      }
      // Any PR (prDate just moved) or a plain tie parks the lift at its peak.
      if (newCeiling || tiedCeiling || prDate === date) peakDate = date;
      if (scoreVal > runMaxScore) runMaxScore = scoreVal;
      if (v.weightKg > runMaxWeight) runMaxWeight = v.weightKg;
    }
    const lastDate = datedBests[datedBests.length - 1][0];
    const stalledWeeks = Math.floor(
      (Date.parse(lastDate) - Date.parse(peakDate)) / (7 * 24 * 60 * 60 * 1000),
    );
    const prBest = byDate[prDate];
    const lastPRDetail = prBest
      ? isAssisted
        ? `${Math.round(prBest.scoreW * 10) / 10}% BW × ${prBest.topReps}`
        : `${Math.round(prBest.weightKg * 10) / 10} kg × ${prBest.topReps}`
      : "";

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
    // Intra-session fatigue, over the same ≤8-session window: what the latest top
    // set fell off, against what THIS lift normally falls off. Absolute drop-off
    // is meaningless across lifts and rep schemes (straight sets to failure shed
    // reps every set by design) — the lift's own median is the only fair yardstick.
    // Baseline excludes the latest session so it can't be judged against itself.
    const windowDropOffs = datedBests.slice(-8).map(([, v]) => v.dropOff);
    const dropOff = windowDropOffs[windowDropOffs.length - 1] ?? null;
    const priorDropOffs = windowDropOffs.slice(0, -1).filter((d): d is number => d !== null);
    const dropOffBaseline = priorDropOffs.length ? median(priorDropOffs) : null;
    // Settled: the stall aged past SETTLED_STALL_WEEKS without declining — the
    // hold is the new baseline, so the attention flag expires (it already said
    // its piece for 12 weeks). Declining re-flags regardless of stall age.
    const settled =
      status === "watch" && stalledWeeks >= SETTLED_STALL_WEEKS && !recovering && !declining;
    const needsAttention =
      declining ||
      (status === "watch" && stalledWeeks >= ATTENTION_STALL_WEEKS && !recovering && !settled);
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
      settled,
      recovering,
      declining,
      recentBests: sessionBests.slice(-8),
      trajectory,
      dropOff,
      dropOffBaseline,
      lastPRKind,
      lastPRDetail,
      milestoneKg: lastPRMilestone ?? undefined,
    });
  }

  strength.healthPct = healthPct(strength.exercises);
  // Trend chip: re-run this same computation on the logs as they stood ~1 month
  // ago and diff. Reuses the whole pipeline (same score mode, same qualifying
  // gate) so the past is measured exactly like the present, and compares only
  // lifts present in BOTH snapshots — see monthAgoTrend.
  if (computeTrend && strength.exercises.length > 0) {
    strength.healthTrend = monthAgoTrend(logsBySlug, strength.exercises, compoundSlugs, namesBySlug, assistedSlugs);
  }

  return strength;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** A <1-point move (after whole-% rounding) is noise, not a trend → "flat". */
const TREND_FLAT_BAND = 1;

/** Latest log date across all lifts (YYYY-MM-DD, compared lexically like the
 *  rest of this module). Two readers: the trend window's reference "now", and
 *  the summary's `lastLogDate` — the training slice's recency. */
function latestLogDate(logsBySlug: LogsBySlug): string | null {
  let max: string | null = null;
  for (const logs of Object.values(logsBySlug)) {
    for (const l of logs) {
      if (l.log_date && (max === null || l.log_date > max)) max = l.log_date;
    }
  }
  return max;
}

/** Latest log date as ms — the reference "now" for the trend window. Data-derived
 *  (not Date.now()) so the read stays pure/deterministic and a month of no logging
 *  doesn't silently collapse the comparison window. */
function latestLogMs(logsBySlug: LogsBySlug): number | null {
  const d = latestLogDate(logsBySlug);
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Health-% delta vs the snapshot ~30 days before the latest log. Filters each
 *  lift's logs to on-or-before the cutoff, re-runs the summary (trend off), and
 *  diffs the two means over the SAME lifts — only those that qualify (≥4
 *  sessions) in BOTH snapshots. Comparing a shared set is the whole point: an
 *  all-lifts mean would move whenever a lift enters/leaves the ≥4-session gate,
 *  so a brand-new low-retention lift could read as "slipping" even though every
 *  existing lift held. Null when no lift is comparable across both. */
function monthAgoTrend(
  logsBySlug: LogsBySlug,
  current: StrengthExercise[],
  compoundSlugs: Set<string> | undefined,
  namesBySlug: Record<string, string> | undefined,
  assistedSlugs: Set<string> | undefined,
): StrengthSummary["healthTrend"] {
  const latest = latestLogMs(logsBySlug);
  if (latest == null) return null;
  // Compare date strings lexically — log_date and this cutoff share YYYY-MM-DD.
  const cutoffISO = new Date(latest - MONTH_MS).toISOString().slice(0, 10);
  const past: LogsBySlug = {};
  for (const [slug, logs] of Object.entries(logsBySlug)) {
    const kept = logs.filter((l) => l.log_date != null && l.log_date <= cutoffISO);
    if (kept.length > 0) past[slug] = kept;
  }
  const pastBySlug = new Map(
    computeStrengthSummary(past, compoundSlugs, namesBySlug, false, assistedSlugs).exercises.map((e) => [
      e.slug,
      retentionOf(e),
    ]),
  );
  // Intersect on slug: a lift only counts if it was judgeable a month ago too.
  const pairs = current.filter((e) => pastBySlug.has(e.slug));
  if (pairs.length === 0) return null;
  const meanNow = pairs.reduce((s, e) => s + retentionOf(e), 0) / pairs.length;
  const meanPast = pairs.reduce((s, e) => s + pastBySlug.get(e.slug)!, 0) / pairs.length;
  const delta = Math.round(meanNow * 100) - Math.round(meanPast * 100);
  const dir = Math.abs(delta) < TREND_FLAT_BAND ? "flat" : delta > 0 ? "up" : "down";
  return { delta: Math.abs(delta), dir };
}

// ─── Training Evaluation (the Decision Engine's training slice) ──────────────

type TrainingTrend = "improving" | "holding" | "declining";

/** Training's derived judgment — a stable trend verdict, NOT a raw watch count.
 *  "declining" requires enough lifts sitting meaningfully below PR *for weeks*
 *  (a real, settled drop), so a single missed session or one-off dip never reads
 *  as decline (staleness is a label, not a decline). Absence of data → low
 *  confidence + "holding", so the engine treats "no info" as "no problem" rather
 *  than firing a bad-news tier. */
export interface TrainingEvaluation {
  trend: TrainingTrend;
  confidence: "low" | "medium" | "high";
  /** Lifts sitting below PR (from the summary) — surfaced for wording/debug.
   *  NOT a decision input: a healthy block almost always carries 1–2 lifts under
   *  94% that are fine (fresh off a PR, visibly rebounding, or a `settled`
   *  baseline). Anything asking "are the lifts in trouble?" reads `attention`. */
  watch: number;
  /** Lifts that actually need intervention — below PR AND stalled ≥3 weeks AND
   *  neither rebounding nor `settled` (summary.attention / `needsAttention`).
   *  This is the softening signal: the same predicate `trend` is built from, at
   *  single-lift granularity, so a rung that wants "any lift in trouble" and the
   *  whole-body trend can't disagree about what trouble means. */
  attention: number;
  /** Lifts at or above their all-time best (status "improving") — the concrete
   *  count the Capitalize rung reports so its copy states a fact, not a slogan. */
  improving: number;
  /** Lifts with enough data to judge (≥4 sessions). */
  total: number;
  /** The single lift most worth naming when everything's green — the fastest
   *  TRUSTED climber (a real consecutive-run velocity, not a fuzzy slope), with
   *  its current best to beat. Null when no lift shows a trusted climb with a
   *  concrete PR detail — the Capitalize copy then falls back to the count alone.
   *  Lets the "add weight" directive point at a specific lift + target instead of
   *  restating progressive overload. */
  leader: { name: string; detail: string } | null;
}

/** A climber's trajectory must clear this confidence for its climb to be
 *  trustworthy enough to NAME in a directive — below it the recent window is too
 *  sparse/shallow to single the lift out. */
const LEADER_MIN_CONFIDENCE = 0.4;

/** Each step of the climb must clear this (1%) — below it the "run" is e1RM float,
 *  not accumulation. Deliberately under RECOVERY_MIN_RATIO's 2%: that gate spans a
 *  whole run, this one is per step. */
const LEADER_MIN_STEP = 0.01;

/** The rate a lift has PROVEN IT CAN REPEAT: the smaller of the two steps across
 *  its last three sessions, and only when both are genuinely up. 0 for every other
 *  shape.
 *
 *  Why not `trajectory.velocity`: that is anchored on the run's trough (see
 *  computeTrajectory), which is right for "is this lift climbing back" but exactly
 *  backwards for "which lift should I push hardest". Trough-anchoring makes the
 *  deepest dip the biggest number — 90→70→100 scores 0.43 while a steady
 *  95→100→105 scores 0.105 — so ranking on it structurally hands the directive to
 *  a lift that just sprang off a low point onto a one-session peak. That shape is
 *  a max attempt: the headroom was just SPENT, and the honest next move is to
 *  consolidate, not to chase it. Two consecutive submaximal steps are the opposite
 *  claim — headroom still on the table — and that is what earns a "push it" call.
 *
 *  Taking the MIN of the two steps (not the total) keeps the ranking on the
 *  repeatable rate: 100→101→130 (one small step + one lunge) must not outrank
 *  100→105→110. */
function sustainedClimb(recentBests: number[]): number {
  if (recentBests.length < 3) return 0;
  const [prior, mid, latest] = recentBests.slice(-3);
  if (prior <= 0 || mid <= 0) return 0;
  const step1 = mid / prior - 1;
  const step2 = latest / mid - 1;
  const slowest = Math.min(step1, step2);
  return slowest >= LEADER_MIN_STEP ? slowest : 0;
}

/** Drop-off this far (10 points) past the lift's OWN median is no longer normal
 *  set-to-set fatigue — it's the session hitting a wall. */
const OVERREACH_EXCESS = 0.1;

/** Did the latest session end at the limit? A top set that shed far more reps
 *  than this lift usually sheds is the tell that the load was maximal, whatever
 *  the score says. Between the session-to-session view (sustainedClimb) and this
 *  within-session one, both have to say "there was room left" before the app tells
 *  you to push harder. False when either number is missing — an unknown is not
 *  evidence of overreach, and the fallback must be to trust the climb. */
function overreached(e: StrengthExercise): boolean {
  if (e.dropOff === null || e.dropOffBaseline === null) return false;
  return e.dropOff >= e.dropOffBaseline + OVERREACH_EXCESS;
}

/** A lift whose last CHANGE is older than this (days), measured against the whole
 *  block's last activity — not the wall clock — is no longer climbing, it's
 *  holding at a ceiling it stopped moving. ~one PPL rotation: a lift untouched
 *  while the rest of the block trained on has plateaued for the purpose of a
 *  "push it further" call, whatever its last three change-events looked like. */
const LEADER_MAX_IDLE_DAYS = 7;

/** Is this lift's climb stale relative to the block? sustainedClimb reads
 *  `recentBests`, which are CHANGE events — a lift that hit a new best and then
 *  repeated it unchanged for weeks logs nothing new, so its last three events
 *  still read as a climb long after it stopped moving (repeat sessions are
 *  invisible here by design — see the export's loggingModel). The lift's own
 *  `lastLogDate` vs the block's newest is the missing recency: it asks "has this
 *  lift moved while everything else kept training?", which the wall clock can't —
 *  the whole block could be legitimately mid-deload. blockLast null (no logs at
 *  all) can't judge staleness → never stale. */
function climbIsStale(e: StrengthExercise, blockLast: string | null): boolean {
  if (!blockLast) return false;
  return daysSince(e.lastLogDate, blockLast) > LEADER_MAX_IDLE_DAYS;
}

/** Pick the lift most worth naming: the strongest SUSTAINED climber that isn't on
 *  watch, didn't end its last session at the wall, is still ACTIVELY moving (not
 *  holding at a ceiling it reached weeks ago), and has a concrete current best to
 *  beat — never merely the fastest mover (see sustainedClimb for why those
 *  differ). `blockLast` = the newest log across the whole block (summary
 *  .lastLogDate), the reference the per-lift idle check measures against. Null
 *  when nothing qualifies (every lift flat AT its PR, holding stale, the only
 *  movers are rebound spikes, or none of the climbers is in the upcoming split) —
 *  the Capitalize rung then stays silent rather than manufacture a vague
 *  "add weight" with no lift to name, which is the correct silence. */
function pickLeader(
  exercises: StrengthExercise[],
  blockLast: string | null,
  /** The upcoming session's split + a slug→split map. When present, the leader is
   *  HARD-filtered to lifts in that split: "add weight this week" is only worth
   *  saying about a lift you'll actually train next, otherwise the named target is
   *  abstract. A lift whose slug isn't in the map is treated as out-of-split (its
   *  split is unknown, so we can't promise it's next). Absent (`split` null) = the
   *  caller has no rotation context → no filter, the block-wide strongest climber
   *  wins, which is the export/legacy behaviour. */
  upcoming?: { split: string | null; splitBySlug: Record<string, string> },
): TrainingEvaluation["leader"] {
  const inUpcomingSplit = ({ e }: { e: StrengthExercise }) =>
    !upcoming || upcoming.split == null || upcoming.splitBySlug[e.slug] === upcoming.split;
  const climbers = exercises
    .map((e) => ({ e, climb: sustainedClimb(e.recentBests) }))
    .filter(
      (c) =>
        c.e.status !== "watch" &&
        c.climb > 0 &&
        !overreached(c.e) &&
        !climbIsStale(c.e, blockLast) &&
        c.e.trajectory.confidence >= LEADER_MIN_CONFIDENCE &&
        c.e.lastPRDetail !== "" &&
        inUpcomingSplit(c),
    )
    .sort((a, b) => b.climb - a.climb);
  return climbers.length
    ? { name: climbers[0].e.name, detail: climbers[0].e.lastPRDetail }
    : null;
}

export function buildTrainingEvaluation(
  summary: StrengthSummary,
  /** Today (YYYY-MM-DD) — injected so this stays pure/testable. Omitted = read
   *  the clock, which is what every non-test caller wants. */
  today?: string,
  /** The upcoming session's split + slug→split map — passed straight to pickLeader
   *  so the named lift is one the user trains next. Omitted (export/legacy) → no
   *  split filter, block-wide strongest climber. */
  upcoming?: { split: string | null; splitBySlug: Record<string, string> },
): TrainingEvaluation {
  const { improving, watch, attention, total, exercises } = summary;
  const leader = pickLeader(exercises, summary.lastLogDate, upcoming);
  // Fewer than two judgeable lifts → we can't claim a trend. Neutral + low
  // confidence so the engine never fires a training-dependent tier off noise.
  if (total < 2)
    return { trend: "holding", confidence: "low", watch, attention, improving, total, leader };

  // A lift counts toward decline only when it's both below PR (watch) AND has
  // carried that gap for ≥3 weeks — a settled drop, not a fresh dip. That's
  // exactly `summary.attention` (needsAttention per lift), which is also what the
  // evaluation now exposes, so the whole-body trend and the per-lift softening
  // signal are literally the same count.
  const stalledWatch = attention;
  const declineThreshold = Math.max(2, Math.ceil(total / 3)); // ≥⅓ of lifts, min 2
  // RECENCY GATE (the same one recovery already applies — see buildRecoveryEvaluation).
  // Every number above is computed from logged sessions and is now-free by design:
  // stalledWeeks runs peak → last log, not peak → today, so silence can never read
  // as decline. That asymmetry is deliberate and stays — but its mirror image has to
  // hold too. A verdict built entirely out of sessions from two months ago is not
  // evidence about THIS week, so after the training freshness window it stops being
  // actionable: confidence drops to low, the engine discretizes that to "unknown",
  // and the tiers that need training evidence (Capitalize's PR push, 2b's strength
  // guardrail) go quiet. Not logging isn't a decline; it also isn't a licence to tell
  // someone laid up sick to add weight. The trend itself is left as-measured — it's
  // still an honest summary of the last block, and confidence is the field that says
  // how much to lean on it.
  const stale = isStale("training", summary.lastLogDate, today);
  const confidence: TrainingEvaluation["confidence"] = stale ? "low" : total >= 4 ? "high" : "medium";

  let trend: TrainingTrend;
  if (stalledWatch >= declineThreshold) trend = "declining";
  // "improving" needs a majority PRing AND no lift that actually needs
  // intervention. Gating on stalledWatch (needsAttention) rather than raw `watch`
  // is a real-data calibration fix: a strong block almost always carries 1–2
  // lagging lifts that are either fresh off a PR (grace window), visibly
  // rebounding, or holding a long-accepted baseline (the `settled` flag) — none
  // is a problem, so none should veto the whole-body "improving" read. Only an
  // ACTIVE stall (3–12 wks, still asking for a deload) or an acute slide should.
  // The majority-PRing gate is what stops a body full of expired stalls from
  // reading "improving": settled lifts aren't in `improving` either. (Export
  // check 2026-07: 8/11 lifts PRing with the only watch lifts being a just-PR'd
  // Assisted Pull-up + a rebounding Leg Curl — old `watch === 0` mislabelled it.)
  else if (improving > total / 2 && stalledWatch === 0) trend = "improving";
  else trend = "holding";

  return { trend, confidence, watch, attention, improving, total, leader };
}
