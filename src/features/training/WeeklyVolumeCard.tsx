import { useRef, useState } from "react";
import { scrollRevealClear } from "@app/layout/revealScroll";
import { MetricValue, MetricDelta } from "@shared/components/Metric";
import { HeadlineCountUp } from "@shared/components/AnimatedNumber";
import { SegmentedControl } from "@shared/components/SegmentedControl";
import type { MuscleVolumeStat, WeeklyVolumeSession, WeeklyVolumeStat } from "./logic";
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

function weekdayShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

// inferMuscleGroup emits lowercase keys ("chest", "unknown") — display-case
// them here; "unknown" reads as Other (an inference gap, not a muscle).
function muscleLabel(group: string): string {
  if (group === "unknown") return "Other";
  return group.charAt(0).toUpperCase() + group.slice(1);
}

// `ahead` marks a last-week session that's later in the week than today — it's
// listed for context but not yet part of the pace-matched comparison, so it's
// dimmed to keep the delta's denominator legible.
function SessionRow({ s, ahead }: { s: WeeklyVolumeSession; ahead?: boolean }) {
  return (
    <div className={`wv-srow${ahead ? " wv-srow--ahead" : ""}`}>
      <span className="wv-srow-date">{fmtSessionDate(s.date)}</span>
      <span className="wv-srow-split">{SPLIT_NAME[s.split] ?? s.split}</span>
      <span className="wv-srow-vol">{Math.round(s.volumeKg).toLocaleString()}</span>
    </div>
  );
}

/* Weekly training volume — total kg lifted this calendar week (Mon-anchored),
   completing each trained split's roster via carry-forward (see
   computeWeeklyVolume). More volume is the goal, so the delta is up-good.
   Tapping the card discloses the breakdown with a Split ⇄ Muscle toggle:
   per-session rows (date · split · kg) or per-muscle-group weekly SET counts
   with their own pace-matched ±set deltas — the same carry-forward rows
   re-bucketed (computeMuscleWeeklyVolume), but counted in sets because kg
   isn't comparable across muscle groups. */
export function WeeklyVolumeCard({
  stat,
  muscle,
  loading,
}: {
  stat?: WeeklyVolumeStat;
  muscle?: MuscleVolumeStat[];
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"split" | "muscle">("split");
  // Expanding can push the session breakdown behind the floating tabbar;
  // scrollRevealClear scrolls it clear in the same motion as the expand, only
  // when occluded. Opening only; called while still collapsed to measure the grow.
  const revealRef = useRef<HTMLDivElement>(null);
  const kg = stat?.thisWeekKg ?? 0;

  const head = (
    <>
      <div className="wv-top">
        <span className="page-eyebrow wv-eyebrow">Weekly Volume</span>
        {!loading && (
          <svg
            className={`wv-chevron${open ? " open" : ""}`}
            width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="wv-row">
        <MetricValue size="lg" unit="kg">
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
    </>
  );

  if (loading || !stat) {
    return <div className="page-card wv-card loading-card">{head}</div>;
  }

  return (
    <div className="page-card wv-card">
      <button
        type="button"
        className="wv-head"
        onClick={() => setOpen((o) => { if (!o) scrollRevealClear(revealRef.current); return !o; })}
        aria-expanded={open}
      >
        {head}
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
                <span className="wv-srow-split">{muscleLabel(m.group)}</span>
                {/* Pace-matched and up-good like the card head, but in absolute
                    ±sets (counts are small — % amplifies ±1-set noise). null
                    (no last-week baseline) renders nothing. */}
                <MetricDelta value={m.deltaSets} direction="up-good" />
                <span className="wv-srow-vol">
                  {m.thisWeekSets}
                  <span className="wv-srow-unit">{m.thisWeekSets === 1 ? " set" : " sets"}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="wv-sessions">
            {stat.thisWeekSessions.length === 0 && (
              <span className="wv-empty">No sessions yet this week</span>
            )}
            {stat.thisWeekSessions.map((s) => (
              <SessionRow key={`${s.split}-${s.date}`} s={s} />
            ))}
            {stat.lastWeekSessions.length > 0 && (() => {
              // Part-way through the week the delta compares against last week
              // *through the same weekday*, so the section total mirrors that
              // pace-matched baseline (later sessions dimmed below). Once the week
              // is complete the cutoff covers everything — plain full total.
              const hasAhead = stat.lastWeekSessions.some((s) => s.date > stat.lastWeekCutoff);
              const sectTotal = hasAhead ? stat.lastWeekKgToDate : stat.lastWeekKg;
              return (
                <>
                  <div className="wv-sect">
                    <span className="wv-sect-label">
                      Last week{hasAhead ? ` · through ${weekdayShort(stat.lastWeekCutoff)}` : ""}
                    </span>
                    <span className="wv-sect-total">
                      {Math.round(sectTotal).toLocaleString()}
                    </span>
                  </div>
                  {stat.lastWeekSessions.map((s) => (
                    <SessionRow key={`${s.split}-${s.date}`} s={s} ahead={s.date > stat.lastWeekCutoff} />
                  ))}
                </>
              );
            })()}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
