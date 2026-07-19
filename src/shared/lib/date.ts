/** Local-timezone date string, e.g. "2026-07-01". */
export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local-timezone date string for N days ago. */
export function localDateStrDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d);
}

const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** "YYYY-MM-DD" → {mon, day, year} for compact timeline/history labels, e.g. {mon:"JUN", day:"25", year:2025}. */
export function timelineDate(isoDate: string): { mon: string; day: string; year: number | null } {
  if (!isoDate) return { mon: "", day: "", year: null };
  const d = new Date(isoDate + "T12:00:00");
  if (isNaN(d.getTime())) return { mon: "", day: String(isoDate), year: null };
  return {
    mon: MONTH_ABBR[d.getMonth()],
    day: String(d.getDate()).padStart(2, "0"),
    year: d.getFullYear(),
  };
}
