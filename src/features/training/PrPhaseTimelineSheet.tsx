// PR + Phase timeline — a single chronological view that overlays every lift's
// PR *events* (each day a lift set a new all-time best, per cmpStrength) on the
// nutrition phase bands (cut / maintenance / bulk) they happened in. It answers
// "which PRs came in which phase" — e.g. seeing a cluster of PRs land in a bulk,
// or strength holding flat through a cut.
//
// Pure presentation: PR events come from buildPrEvents (the app's own PR
// comparator), phase spans from buildTargetPhases (the same reconstruction the
// export uses). Phase bands are drawn NEUTRAL with text labels + dividers, not
// coloured hues — a phase isn't a good/bad verdict, and the colour rule reserves
// tone for verdicts; the only accent is the PR dots (a brand mark, not a tone).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { timelineDate } from "@shared/lib/date";
import { getEntries } from "@features/nutrition/api";
import { buildTargetPhases, phaseKindAt, type TargetPhase } from "@shared/lib/phaseTimeline";
import { type PhaseKind } from "@features/nutrition/logic";
import { buildPrEvents } from "./logic";
import { defaultSetCount } from "./logFormHelpers";
import { fmtWeightNum } from "./ExprDisplay";
import { formatRepsDisplay } from "./parser";
import type { Exercise, TrainingLog } from "./api";

const PHASE_LABEL: Record<PhaseKind, string> = {
  cut: "Cut",
  maintenance: "Maint",
  bulk: "Bulk",
};

interface TimelinePr {
  slug: string;
  name: string;
  date: string;
  weightKg: number;
  reps: string;
  phase: PhaseKind | null;
}

const parseMs = (d: string) => Date.parse(d);

function SheetInner({
  exercises,
  logs,
  closing,
  onClose,
}: {
  exercises: Exercise[];
  logs: Record<string, TrainingLog[]>;
  closing: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, onClose);
  const { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  const [phases, setPhases] = useState<TargetPhase[] | null>(null);

  // All PR events across every non-archived lift, computed from the logs already
  // in memory (no fetch). Each lift's events use its own scoring axis via the
  // compound flag — buildPrEvents folds that through cmpStrength.
  const prs = useMemo(() => {
    const out: Omit<TimelinePr, "phase">[] = [];
    for (const ex of exercises) {
      if (ex.archived) continue;
      const evts = buildPrEvents(
        logs[ex.slug] ?? [],
        defaultSetCount(ex),
        ex.compound ? "compound" : "isolation",
        !!ex.assisted_mode,
      );
      for (const e of evts) {
        out.push({ slug: ex.slug, name: ex.name, date: e.date, weightKg: e.weightKg, reps: e.reps });
      }
    }
    return out.sort((a, b) => parseMs(a.date) - parseMs(b.date));
  }, [exercises, logs]);

  // Phase spans reconstructed from nutrition entries — lazily fetched on open
  // (the timeline is a rarely-opened analytical view; no reason to load it with
  // the tab). Window spans from the earliest PR to today so the bands cover the
  // whole strength history. Best-effort: a failure just drops the bands.
  useEffect(() => {
    let alive = true;
    const from = prs[0]?.date ?? phasesFallbackFrom();
    const to = new Date().toISOString().slice(0, 10);
    getEntries(from, to)
      .then((entries) => alive && setPhases(buildTargetPhases(entries)))
      .catch(() => alive && setPhases([]));
    return () => {
      alive = false;
    };
    // Only the first PR date matters for the fetch window; recomputing on every
    // prs identity change would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prs[0]?.date]);

  // Attribute each PR to the phase in force on its date (once spans are in).
  const attributed: TimelinePr[] = useMemo(
    () => prs.map((p) => ({ ...p, phase: phases ? phaseKindAt(phases, p.date) : null })),
    [prs, phases],
  );

  // PR count per phase kind — the one-glance read ("most PRs landed in the
  // cut"). A proportional-date strip was tried and dropped: PR density is very
  // uneven (sparse early, dense recent), so it always crammed into one edge.
  // Counts can't cram. `null` = PRs before any logged phase (pre-tracking).
  const phaseCounts = useMemo(() => {
    const c: Record<PhaseKind, number> = { cut: 0, maintenance: 0, bulk: 0 };
    let earlier = 0;
    for (const p of attributed) {
      if (p.phase) c[p.phase]++;
      else earlier++;
    }
    return { ...c, earlier };
  }, [attributed]);

  // Ordinal timeline: each PR takes an EQUAL slot in chronological order, so
  // dots never cram and never blob (unlike a real-date axis, where uneven PR
  // density squished everything to one edge). Phase bands span the contiguous
  // run of PRs that share a phase — so a band's WIDTH is how many PRs that phase
  // produced, which is the read we actually want ("most PRs came in the cut").
  const bands = useMemo(() => {
    const n = attributed.length;
    if (!n) return [];
    const runs: { startIdx: number; count: number; kind: PhaseKind | null }[] = [];
    attributed.forEach((p, i) => {
      const last = runs.at(-1);
      if (last && last.kind === p.phase) last.count++;
      else runs.push({ startIdx: i, count: 1, kind: p.phase });
    });
    return runs.map((b) => {
      const width = (b.count / n) * 100;
      return { left: (b.startIdx / n) * 100, width, kind: b.kind, showLabel: b.kind != null && width >= 12 };
    });
  }, [attributed]);

  const n = attributed.length;
  const newestFirst = [...attributed].reverse();
  const loadingPhases = phases == null;
  const summaryParts: string[] = [];
  (["cut", "bulk", "maintenance"] as PhaseKind[]).forEach((k) => {
    if (phaseCounts[k] > 0) summaryParts.push(`${phaseCounts[k]} in ${PHASE_LABEL[k]}`);
  });
  if (phaseCounts.earlier > 0 && !loadingPhases) summaryParts.push(`${phaseCounts.earlier} earlier`);
  const firstDate = attributed[0] ? timelineDate(attributed[0].date) : null;
  const lastDate = attributed[n - 1] ? timelineDate(attributed[n - 1].date) : null;

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet prtl-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label="PR and phase timeline"
      >
        <div
          className="settings-sheet-grabber"
          aria-hidden
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        />
        <div
          className="settings-sheet-header"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
        >
          <span className="settings-sheet-title">PR Timeline</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body prtl-body">
          {prs.length === 0 ? (
            <p className="prtl-empty">
              No PRs on record yet — once a lift beats its best, the breakthrough shows here against the phase it landed in.
            </p>
          ) : (
            <>
              {/* One-glance summary: how many PRs landed in each phase. */}
              <div className="prtl-summary">
                <span className="prtl-summary-total">
                  {prs.length} PR{prs.length === 1 ? "" : "s"}
                </span>
                {summaryParts.length > 0 && (
                  <span className="prtl-summary-breakdown">{summaryParts.join(" · ")}</span>
                )}
              </div>

              {/* Ordinal timeline: PRs left→right in order, equal slots; phase
                  bands sized by PR count. Axis ends are the first/last PR date
                  (order is chronological, spacing is by sequence, not by date). */}
              <div className="prtl-strip">
                <div className="prtl-dots">
                  {attributed.map((p, i) => (
                    <span
                      key={`${p.slug}-${p.date}-${i}`}
                      className="prtl-dot"
                      style={{ left: `${((i + 0.5) / n) * 100}%` }}
                      title={`${p.name} · ${fmtWeightNum(p.weightKg)}×${formatRepsDisplay(p.reps)} · ${timelineDate(p.date).mon} ${timelineDate(p.date).day}`}
                    />
                  ))}
                </div>
                <div className="prtl-band">
                  {bands.map((b, i) => (
                    <div
                      key={i}
                      className={`prtl-seg${b.kind == null ? " is-untracked" : ""}`}
                      style={{ left: `${b.left}%`, width: `${b.width}%` }}
                    >
                      {b.showLabel && <span className="prtl-seg-label">{PHASE_LABEL[b.kind!]}</span>}
                    </div>
                  ))}
                </div>
                {firstDate && lastDate && (
                  <div className="prtl-axis">
                    <span>{firstDate.mon} {firstDate.day}</span>
                    <span>{lastDate.mon} {lastDate.day}</span>
                  </div>
                )}
              </div>

              {/* PR list, newest first, each tagged with its phase. */}
              <ul className="prtl-list">
                {newestFirst.map((p, i) => {
                  const d = timelineDate(p.date);
                  return (
                    <li key={`${p.slug}-${p.date}-${i}`} className="prtl-row">
                      <span className="prtl-row-main">
                        <span className="prtl-row-name">{p.name}</span>
                        <span className="prtl-row-set mono">{fmtWeightNum(p.weightKg)}×{formatRepsDisplay(p.reps)}</span>
                      </span>
                      <span className="prtl-row-meta">
                        {p.phase && <span className="prtl-chip">{PHASE_LABEL[p.phase]}</span>}
                        {!p.phase && loadingPhases && <span className="prtl-chip is-loading">·</span>}
                        <span className="prtl-row-date mono">{d.mon} {d.day}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Fallback fetch-window start when there are no PRs yet to anchor it (the
 *  sheet shows its empty state in that case, so this only bounds the query). */
function phasesFallbackFrom(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function PrPhaseTimelineSheet({
  exercises,
  logs,
  open,
  onClose,
}: {
  exercises: Exercise[];
  logs: Record<string, TrainingLog[]>;
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted) return null;
  return <SheetInner exercises={exercises} logs={logs} closing={closing} onClose={onClose} />;
}
