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
import { phaseKindFromName, type PhaseKind } from "@features/nutrition/logic";
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

  // Time axis: earliest PR (or phase start) → today. Guard a zero/negative span
  // (single day of history) so projection can't divide by zero.
  const t0 = useMemo(() => {
    const dates = [
      ...prs.map((p) => parseMs(p.date)),
      ...(phases ?? []).map((ph) => parseMs(ph.from)),
    ].filter((n) => isFinite(n));
    return dates.length ? Math.min(...dates) : Date.now();
  }, [prs, phases]);
  const t1 = Date.now();
  const span = Math.max(1, t1 - t0);
  const xPct = (d: string) => Math.max(0, Math.min(100, ((parseMs(d) - t0) / span) * 100));

  // Phase segments clipped to the drawn window. Consecutive spans of the SAME
  // phase KIND are coalesced into one band — the timeline reads phases, not the
  // many intake tweaks WITHIN a cut (each retargets a span, all still "cut"),
  // which otherwise stack into an illegible row of overlapping labels.
  const segments = useMemo(() => {
    if (!phases) return [];
    const relevant = phases.filter((ph) => ph.cutPhase && parseMs(ph.to) >= t0);
    const merged: { from: string; to: string; kind: PhaseKind }[] = [];
    for (const ph of relevant) {
      const kind = phaseKindFromName(ph.cutPhase!);
      const last = merged.at(-1);
      if (last && last.kind === kind) last.to = ph.to;
      else merged.push({ from: ph.from, to: ph.to, kind });
    }
    return merged.map((m) => {
      const left = xPct(m.from);
      const width = Math.max(0.5, xPct(m.to) - left);
      // Only wide-enough bands carry text — a label on a sliver overflows into
      // its neighbours (the exact cramming this whole merge fixes).
      return { left, width, kind: m.kind, showLabel: width >= 14 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases, t0]);

  const newestFirst = [...attributed].reverse();
  const loadingPhases = phases == null;

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
              {/* Timeline strip: neutral phase band with labelled segments, PR
                  dots (accent) plotted on the same date axis above it. */}
              <div className="prtl-strip">
                <div className="prtl-dots">
                  {attributed.map((p, i) => (
                    <span
                      key={`${p.slug}-${p.date}-${i}`}
                      className="prtl-dot"
                      style={{ left: `${xPct(p.date)}%` }}
                      title={`${p.name} · ${fmtWeightNum(p.weightKg)}×${formatRepsDisplay(p.reps)} · ${timelineDate(p.date).mon} ${timelineDate(p.date).day}`}
                    />
                  ))}
                </div>
                <div className="prtl-band">
                  {segments.map((s, i) => (
                    <div
                      key={i}
                      className="prtl-seg"
                      style={{ left: `${s.left}%`, width: `${s.width}%` }}
                    >
                      {s.showLabel && <span className="prtl-seg-label">{PHASE_LABEL[s.kind]}</span>}
                    </div>
                  ))}
                </div>
                <div className="prtl-axis">
                  <span>{timelineDate(new Date(t0).toISOString().slice(0, 10)).mon} {timelineDate(new Date(t0).toISOString().slice(0, 10)).day}</span>
                  <span>Today</span>
                </div>
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
