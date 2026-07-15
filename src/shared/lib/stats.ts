// Shared statistics helpers used by engine-read trend math.

/** Ordinary-least-squares fit over the trailing `days`-day window of a dated
 *  series. Returns the per-day slope AND the standard error of that slope, so a
 *  caller can tell a real trend from scatter (an SE-relative significance gate
 *  auto-adapts to each series' own noise instead of a fixed deadband). Callers
 *  apply their own scaling (×7 for per-week, ×30 for per-month) and their own
 *  minimum point count.
 *
 *  Dates are anchored at local noon (`+"T12:00:00"`) so DST shifts can't move a
 *  reading across a day boundary; x is integer days since the window's first
 *  reading. Uses the mean-centered normal equations (numerically stabler than
 *  the raw Σx²-form). Returns null when the window is too sparse (< `minPoints`)
 *  or degenerate (all readings on one day). */
export function olsFit(
  pts: { date: string; value: number }[],
  days: number,
  minPoints: number,
): { slopePerDay: number; seSlopePerDay: number } | null {
  const last = pts.at(-1)?.date;
  if (!last) return null;
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const win = pts.filter((p) => p.date >= cutoffStr);
  if (win.length < minPoints) return null;
  const MS = 86400000;
  const t0 = new Date(win[0].date + "T12:00:00").getTime();
  const xs = win.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / MS);
  const ys = win.map((p) => p.value);
  const n = win.length;
  const meanX = xs.reduce((a, x) => a + x, 0) / n;
  const meanY = ys.reduce((a, y) => a + y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const slopePerDay = sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;
  // SE of the slope = residual SD / sqrt(Σ(x−x̄)²). n>2 is assured by the
  // minPoints guard (all callers pass ≥5); sxx>0 by the degeneracy guard above.
  const sse = ys.reduce((a, y, i) => a + (y - (intercept + slopePerDay * xs[i])) ** 2, 0);
  const seSlopePerDay = Math.sqrt(sse / (n - 2) / sxx);
  return { slopePerDay, seSlopePerDay };
}
