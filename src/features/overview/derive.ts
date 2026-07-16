// Pure gating / derived-value helpers for the Overview cards. Extracted from
// page.tsx so the branch-heavy bits (week banking, the week-strip cells, the
// phase-plan note ladder, the sparkline geometry) are unit-tested rather than
// buried inline in the render tree. Every function here is a pure transform of
// its inputs — no React, no clock, no DOM.
import { median } from "@features/health/math";
import { progressColor } from "@shared/lib/progressColor";
import { localDateStr } from "@shared/lib/date";
import type { BodyMetric } from "@features/health/api";
import type { ActiveTargetView } from "@features/health/activeTarget";
import type { GoalStatusEvaluation, BulkGoalStatusEvaluation } from "./goal";
import type { PhaseKind } from "@features/nutrition/logic";
import type { RateTone } from "@features/nutrition/recommendation";
import { WEEKDAY_ABBR, shiftISODays, diffDays } from "./format";

/* ── Active Target ─────────────────────────────────────────────────────── */

/** How today's floating target sits vs the flat daily average. The ±30 kcal
 *  deadband (≈ a couple of minutes of movement) is purely anti-flicker, not a
 *  meaningful "close enough" bar. */
export function activeTargetPosition(todayTarget: number, dailyAvg: number): "on" | "behind" | "ahead" {
  const diff = todayTarget - dailyAvg;
  return Math.abs(diff) <= 30 ? "on" : diff > 0 ? "behind" : "ahead";
}

/** Sum of a completed week's synced active-energy, Mon→Sun from mondayISO. */
export function weekActiveTotal(metrics: BodyMetric[], mondayISO: string): number {
  const next = shiftISODays(mondayISO, 7);
  return metrics
    .filter((m) => m.metric_date >= mondayISO && m.metric_date < next && m.active_energy_kcal != null)
    .reduce((s, m) => s + (m.active_energy_kcal ?? 0), 0);
}

/** Footer balance vs the flat pace. Current week: the live "through yesterday
 *  vs flat pace" running figure. A completed past week: its full-week total vs
 *  the 7-day goal (a retrospective settle). `pastWeekTotal` is ignored for the
 *  current week — pass weekActiveTotal(metrics, mondayISO) for a past week. */
export function weekBanked(view: ActiveTargetView, isCurrentWeek: boolean, pastWeekTotal: number): number {
  const perDay = view.activeTargetPerDay;
  return isCurrentWeek
    ? view.accruedThroughYesterday - perDay * (view.weekday - 1)
    : Math.round(pastWeekTotal - perDay * 7);
}

/** Banked-figure tone; ±30 kcal deadband (same anti-flicker bar as position). */
export function bankedTone(banked: number): "good" | "warn" | "neutral" {
  return banked > 30 ? "good" : banked < -30 ? "warn" : "neutral";
}

export interface WeekCell {
  date: string;
  letter: string;
  kind: "today" | "future" | "past";
  fill: number;
  ringColor: string | undefined;
}

/** The seven Mon→Sun cells of the week strip. Today follows the floating ring's
 *  ratio; future days are empty; a past day rides the flat per-day ratio. A met
 *  day reads --good green here (not the ring's completion gold — the ring is the
 *  card's one gold spot, so a row of gold bars would dilute it). */
export function weekStripCells(
  view: ActiveTargetView,
  metrics: BodyMetric[],
  mondayISO: string,
  todayISO: string,
): WeekCell[] {
  const perDay = view.activeTargetPerDay;
  const monday = new Date(`${mondayISO}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const date = localDateStr(new Date(monday.getTime() + i * 86400000));
    const letter = WEEKDAY_ABBR[new Date(`${date}T12:00:00`).getDay()][0];
    if (date === todayISO) {
      const ratio = view.today.accrued / Math.max(1, view.today.target);
      const ringColor = ratio >= 1 ? "var(--good)" : progressColor(ratio);
      return { date, letter, kind: "today" as const, fill: Math.min(1, ratio), ringColor };
    }
    if (date > todayISO) return { date, letter, kind: "future" as const, fill: 0, ringColor: undefined };
    const active = metrics.find((m) => m.metric_date === date)?.active_energy_kcal ?? 0;
    const ratio = perDay > 0 ? active / perDay : 0;
    return {
      date,
      letter,
      kind: "past" as const,
      fill: Math.min(1, ratio),
      ringColor: ratio >= 1 ? "var(--good)" : progressColor(ratio),
    };
  });
}

/* ── Phase plan (roadmap) ──────────────────────────────────────────────── */

/** One-line roadmap read, in the engine's ladder order, per phase:
 *  maintenance → hold; cut at goal → start maintenance; bulk at the ceiling →
 *  start the cut; signals stacked (same gate the engine decided with) →
 *  consider leaving; otherwise explain what the lights watch for. */
export function phasePlanNote(
  phaseKind: PhaseKind,
  goalStatus: GoalStatusEvaluation,
  bulkGoalStatus: BulkGoalStatusEvaluation | null,
  firingCount: number,
  triggerCount: number,
  considerEnterCount: number,
): { text: string; tone: string } {
  const n = firingCount;
  if (phaseKind === "maintenance") {
    return { text: "Hold for 4–6 weeks, then start the lean bulk.", tone: "" };
  }
  if (phaseKind === "bulk") {
    return bulkGoalStatus?.reached
      ? { text: `Body fat has reached your ${bulkGoalStatus.bfCeilingPct}% ceiling — start the cut.`, tone: " is-go" }
      : n >= considerEnterCount
        ? { text: `${n} of ${triggerCount} signals are on — consider a maintenance break.`, tone: " is-consider" }
        : { text: "Building — switch early if these stack up:", tone: "" };
  }
  return goalStatus.reached
    ? { text: `Body fat has reached your ${goalStatus.targetBodyFatPct}% goal — start maintenance.`, tone: " is-go" }
    : n >= considerEnterCount
      ? { text: `${n} of ${triggerCount} signals are on — consider switching to maintenance.`, tone: " is-consider" }
      : { text: "Switch early if these stack up:", tone: "" };
}

/** The Cut stage names its ENDPOINT ("Cut → 12% BF"), falling back to a bare
 *  "Cut" only when no body-fat target is configured. */
export function cutStageLabel(targetBodyFatPct: number | null): string {
  return targetBodyFatPct != null ? `Cut → ${targetBodyFatPct}% BF` : "Cut";
}

/** Same endpoint-naming for the Lean Bulk stage — its endpoint is the body-fat
 *  CEILING ("Lean Bulk → 21% cap"), bare "Lean Bulk" until one is configured. */
export function bulkStageLabel(bfCeilingPct: number | null): string {
  return bfCeilingPct != null ? `Lean Bulk → ${bfCeilingPct}% cap` : "Lean Bulk";
}

/* ── Weight card ───────────────────────────────────────────────────────── */

/** Trend-line tone from the week-over-week delta (down = good on a cut). */
export function weightLineTone(weightDelta: number | null): "good" | "bad" | "flat" {
  return weightDelta == null ? "flat" : weightDelta < 0 ? "good" : weightDelta > 0 ? "bad" : "flat";
}

/** Acceleration-arrow tone: a real out-of-band rate drift dominates (bad/warn);
 *  otherwise a slowdown warns (early-plateau catch) and in-band reads good.
 *  Never gold — how good the value IS lives on the status pill, not this arrow. */
export function accelArrowTone(
  rateBandTone: RateTone,
  accelDirection: "faster" | "slowing" | null,
): "good" | "warn" | "bad" {
  return rateBandTone === "bad"
    ? "bad"
    : rateBandTone === "warn"
      ? "warn"
      : accelDirection === "slowing"
        ? "warn"
        : "good";
}

/* ── Weight sparkline geometry ─────────────────────────────────────────── */

// SVG viewBox: stretched non-uniformly to fill the card (preserveAspectRatio
// none). W=100 maps to the card width, H maps 1:1 to the fixed CSS height.
export const SPARK_W = 100;
export const SPARK_H = 96;
export const SPARK_PAD = 4;
const WEIGHT_SPARK_MIN_SPAN = 1; // kg — floor so a flat week doesn't fill height

export interface SparkGeometry {
  /** "x,y x,y …" polyline points for the trend line. */
  pts: string;
  /** Closed polygon (line + baseline) for the gradient area fill. */
  area: string;
  /** Target-pace wedge vertices, or null when no active band / zero window. */
  corridor: { x0: number; y0: number; xEnd: number; yMin: number; yMax: number } | null;
  /** The enlarged "you are here" dot at the latest reading. */
  latest: { x: number; y: number };
}

/** Project a pre-smoothed weight trend (≥2 points) into the sparkline's SVG
 *  coordinate space, plus the optional target-pace corridor wedge.
 *
 *  The corridor rays anchor at the Theil-Sen fit of the drawn trend evaluated at
 *  the window start — NOT at the first drawn point — so the wedge fans out from
 *  the same fit the pace badge grades the window's median slope against; a
 *  single low/high edge day can't tilt the whole wedge. The vertical scale spans
 *  the line AND the corridor vertices so the wedge never clips. */
export function buildSparkGeometry(
  points: { date: string; value: number }[],
  targetRange: { min: number; max: number } | null | undefined,
): SparkGeometry {
  const trend = points;
  const trendValues = trend.map((p) => p.value);
  const windowDays = diffDays(trend[0].date, trend.at(-1)!.date);

  const hasCorridor = !!targetRange && targetRange.min !== targetRange.max && windowDays > 0;
  let corridorAnchor: number | null = null;
  if (hasCorridor) {
    const t0 = new Date(trend[0].date + "T12:00:00").getTime();
    const xs = trend.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / 86400000);
    const pairSlopes: number[] = [];
    for (let i = 0; i < trend.length; i++)
      for (let j = i + 1; j < trend.length; j++)
        if (xs[j] !== xs[i]) pairSlopes.push((trendValues[j] - trendValues[i]) / (xs[j] - xs[i]));
    const fitSlope = median(pairSlopes);
    corridorAnchor = median(trendValues.map((v, i) => v - fitSlope * xs[i]));
  }
  const corridorMinVal = corridorAnchor != null ? corridorAnchor - targetRange!.min * (windowDays / 7) : null;
  const corridorMaxVal = corridorAnchor != null ? corridorAnchor - targetRange!.max * (windowDays / 7) : null;

  const scaleValues = [...trendValues];
  if (corridorAnchor != null) scaleValues.push(corridorAnchor);
  if (corridorMinVal != null) scaleValues.push(corridorMinVal);
  if (corridorMaxVal != null) scaleValues.push(corridorMaxVal);
  const min = Math.min(...scaleValues), max = Math.max(...scaleValues);
  const center = (min + max) / 2;
  const half = Math.max(max - min, WEIGHT_SPARK_MIN_SPAN) / 2;
  const lo = center - half;
  const span = half * 2 || 1;
  const valueToY = (v: number) => SPARK_H - SPARK_PAD - ((v - lo) / span) * (SPARK_H - SPARK_PAD * 2);

  const coords = trendValues.map((v, i) => {
    const x = SPARK_PAD + (i / (trendValues.length - 1)) * (SPARK_W - SPARK_PAD * 2);
    return { x, y: valueToY(v) };
  });
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const first = coords[0], last = coords[coords.length - 1];
  const area = `${pts} ${last.x.toFixed(1)},${SPARK_H} ${first.x.toFixed(1)},${SPARK_H}`;

  const corridor = corridorAnchor != null
    ? {
        x0: first.x, y0: valueToY(corridorAnchor),
        xEnd: last.x,
        yMin: valueToY(corridorMinVal!),
        yMax: valueToY(corridorMaxVal!),
      }
    : null;

  return { pts, area, corridor, latest: coords[coords.length - 1] };
}
