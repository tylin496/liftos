import { useRef, useState } from "react";
import { scrollRevealClear } from "@app/layout/revealScroll";
import { MetricValue, MetricDelta, MetricCaption } from "@shared/components/Metric";
import { HeadlineCountUp } from "@shared/components/AnimatedNumber";
import { SegmentedControl } from "@shared/components/SegmentedControl";
import { ChartGlyph } from "./ExerciseCard";
import { WeeklyVolumeTrendSheet } from "./WeeklyVolumeTrendSheet";
import type { MuscleVolumeStat, WeeklyVolumeSession, WeeklyVolumeStat, WeeklyVolumeTrendPoint } from "./logic";
import { SPLITS } from "./seed";
import "./weeklyVolumeCard.css";

const SPLIT_NAME = Object.fromEntries(SPLITS.map((s) => [s.id, s.name]));

// "Wed 7/9" — weekday leads because the rows live inside a one-week context;
// the month/day disambiguates last week's rows.
function fmtSessionDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${wd} ${d.getMonth() + 1}/${d.getDate()}`;
}

// inferMuscleGroup emits lowercase keys ("chest", "unknown") — display-case
// them here; "unknown" reads as Other (an inference gap, not a muscle).
function muscleLabel(group: string): string {
  if (group === "unknown") return "Other";
  return group.charAt(0).toUpperCase() + group.slice(1);
}

// Whole averages print bare ("6"), fractional ones keep a single decimal
// ("5.5") — more digits would overstate what a 4-week average can resolve.
function fmtAvgSets(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function SessionRow({ s }: { s: WeeklyVolumeSession }) {
  return (
    <div className="wv-srow">
      <span className="wv-srow-date">{fmtSessionDate(s.date)}</span>
      <span className="wv-srow-split">
        {SPLIT_NAME[s.split] ?? s.split}
        {/* Rest-day extra: only the logged set's volume, no roster carry-
            forward — the tag keeps a small kg number from reading as a
            crashed session. */}
        {s.bonus && <span className="wv-srow-bonus">bonus</span>}
      </span>
      <span className="wv-srow-vol">{Math.round(s.volumeKg).toLocaleString()}</span>
    </div>
  );
}

/* Weekly training volume — average kg per week over the trailing ≤4 completed
   Mon–Sun weeks, completing each trained split's roster via carry-forward
   (see computeWeeklyVolume). The delta judges that average against the
   previous window's (up-good) — week-vs-week was too noisy to steer by.
   Tapping the card discloses the breakdown with a Split ⇄ Muscle toggle:
   this/last week's per-session rows (date · split · kg) or per-muscle-group
   average weekly SET counts — the same carry-forward rows re-bucketed
   (computeMuscleWeeklyVolume), but counted in sets because kg isn't
   comparable across muscle groups. */
export function WeeklyVolumeCard({
  stat,
  muscle,
  trend,
  nameBySlug,
  loading,
}: {
  stat?: WeeklyVolumeStat;
  muscle?: MuscleVolumeStat[];
  /** Maintained weekly totals for the trend sheet (computeWeeklyVolumeTrend). */
  trend?: WeeklyVolumeTrendPoint[];
  /** slug → display name, for the muscle rows' contributing-lifts caption. */
  nameBySlug?: Map<string, string>;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);
  const [view, setView] = useState<"split" | "muscle">("split");
  // Expanding can push the session breakdown behind the floating tabbar;
  // scrollRevealClear scrolls it clear in the same motion as the expand, only
  // when occluded. Opening only; called while still collapsed to measure the grow.
  const revealRef = useRef<HTMLDivElement>(null);
  const kg = stat?.avgWeekKg ?? 0;
  const toggleOpen = () =>
    setOpen((o) => { if (!o) scrollRevealClear(revealRef.current); return !o; });

  /* "4-wk avg" in the eyebrow is the basis marker, not a caption — the
     headline changed meaning from this-week total to trailing average, and
     read-only viewers can't know that without it. Full basis stays in the
     export. */
  const eyebrow = <span className="page-eyebrow wv-eyebrow">Weekly Volume 4-wk avg</span>;

  const valueRow = (
    <div className="wv-row">
      <MetricValue size="lg" unit="kg/wk">
        {loading ? (
          "00,000"
        ) : (
          <HeadlineCountUp value={Math.round(kg)} format={(n) => n.toLocaleString()} />
        )}
      </MetricValue>
      {!loading && (
        <MetricDelta value={stat?.deltaPct} direction="up-good" unit="%" decimals={0} />
      )}
    </div>
  );

  /* The headline is a trailing average, so the collapsed face carries the
     current week's running total — the one number that otherwise only lives
     inside the disclosure. It collapses away while open: the reveal's
     "This week" section header repeats it right below. */
  const thisWeek = (
    <div className={`wv-thisweek${open ? " open" : ""}`}>
      <div className="wv-thisweek-inner">
        <MetricCaption>
          This week{" "}
          {loading || !stat ? "0,000" : Math.round(stat.thisWeekKg).toLocaleString()} kg
        </MetricCaption>
      </div>
    </div>
  );

  if (loading || !stat) {
    return (
      <div className="page-card wv-card loading-card">
        <div className="wv-top">{eyebrow}</div>
        {valueRow}
        {thisWeek}
      </div>
    );
  }

  return (
    <div className="page-card wv-card">
      <div className="wv-top">
        {/* Same affordance language as the exercise cards: title + chart glyph
            opens the trend, so the two tap targets (trend vs disclosure) stay
            siblings instead of nesting buttons. */}
        <button
          type="button"
          className="wv-eyebrow-btn"
          onClick={() => setTrendOpen(true)}
          aria-label="Weekly volume — view trend"
        >
          {eyebrow}
          <ChartGlyph className="wv-trend-glyph" />
        </button>
        {/* Pointer duplicate of the value-row toggle below (which carries the
            accessible expanded state) — keeps the chevron corner tappable. */}
        <button
          type="button"
          className="wv-chevron-btn"
          onClick={toggleOpen}
          tabIndex={-1}
          aria-hidden="true"
        >
          <svg
            className={`wv-chevron${open ? " open" : ""}`}
            width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <button type="button" className="wv-head" onClick={toggleOpen} aria-expanded={open}>
        {valueRow}
        {thisWeek}
      </button>
      <div ref={revealRef} className={`wv-reveal${open ? " open" : ""}`}>
        {/* Single grid child — the 0fr→1fr disclosure needs exactly one. */}
        <div className="wv-reveal-inner">
        {muscle && muscle.length > 0 && (
          <div className="wv-view-seg">
            <SegmentedControl
              options={[
                { id: "split", label: "By split" },
                { id: "muscle", label: "By muscle" },
              ]}
              value={view}
              onChange={(id) => setView(id as "split" | "muscle")}
            />
          </div>
        )}
        {view === "muscle" && muscle && muscle.length > 0 ? (
          <div className="wv-sessions">
            {muscle.map((m) => (
              <div className="wv-srow" key={m.group}>
                <span className="wv-srow-split">
                  {muscleLabel(m.group)}
                  {/* The evidence line: which lifts this number is made of.
                      Primary-muscle-only means the sets are exactly these
                      lifts' direct sets — listing them keeps "Back 9" from
                      reading as over-training when it's 2 lifts × frequency. */}
                  <span className="wv-srow-lifts">
                    {m.slugs.map((s) => nameBySlug?.get(s) ?? s).join(" + ")}
                  </span>
                </span>
                {/* vs the previous window's average, up-good like the card
                    head, but in absolute ±sets (counts are small — % amplifies
                    sub-set noise). null (no prior window) renders nothing. */}
                <MetricDelta value={m.deltaSets} direction="up-good" decimals={1} />
                <span className="wv-srow-vol">
                  {fmtAvgSets(m.avgWeekSets)}
                  <span className="wv-srow-unit">
                    {m.avgWeekSets === 1 ? " set/wk" : " sets/wk"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="wv-sessions">
            {/* The headline is a trailing average, so the current week lives
                here: labelled section totals, this week then last. */}
            <div className="wv-sect">
              <span className="wv-sect-label">This week</span>
              <span className="wv-sect-total">
                {Math.round(stat.thisWeekKg).toLocaleString()}
              </span>
            </div>
            {stat.thisWeekSessions.length === 0 && (
              <span className="wv-empty">No sessions yet this week</span>
            )}
            {stat.thisWeekSessions.map((s) => (
              <SessionRow key={`${s.split}-${s.date}`} s={s} />
            ))}
            {stat.lastWeekSessions.length > 0 && (
              <>
                <div className="wv-sect">
                  <span className="wv-sect-label">Last week</span>
                  <span className="wv-sect-total">
                    {Math.round(stat.lastWeekKg).toLocaleString()}
                  </span>
                </div>
                {stat.lastWeekSessions.map((s) => (
                  <SessionRow key={`${s.split}-${s.date}`} s={s} />
                ))}
              </>
            )}
          </div>
        )}
        </div>
      </div>
      {trend && (
        <WeeklyVolumeTrendSheet
          points={trend}
          avgWeekKg={stat.avgWeekKg}
          open={trendOpen}
          onClose={() => setTrendOpen(false)}
        />
      )}
    </div>
  );
}
