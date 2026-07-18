// Phase retrospective sheet — the settled read of a CLOSED cut/bulk, opened
// from the Journey card's roadmap ("Completed phases" rows). Pure render: every
// number was settled into the phase_reports row at close time (see
// shared/lib/phaseReport.ts); nothing here recomputes. All values render in
// neutral ink — a finished phase is history/context, not a verdict to re-judge
// — and deltas keep their explicit ▲/▼ direction.
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { timelineDate } from "@shared/lib/date";
import type { PhaseReport } from "./api";

const fmt0 = (v: number) => Math.round(v).toLocaleString();
const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);

/** "Mar 1 – Jul 18", with years appended when the span crosses a year
 *  boundary ("Nov 3 2025 – Feb 9 2026") — a cut can easily straddle one. */
export function phaseSpanLabel(startDate: string, endDate: string): string {
  const s = timelineDate(startDate);
  const e = timelineDate(endDate);
  const sy = startDate.slice(0, 4);
  const ey = endDate.slice(0, 4);
  return sy === ey
    ? `${s.mon} ${s.day} – ${e.mon} ${e.day}`
    : `${s.mon} ${s.day} ${sy} – ${e.mon} ${e.day} ${ey}`;
}

export const phaseKindLabel = (kind: string) => (kind === "bulk" ? "Lean Bulk" : "Cut");

/** The headline weight move, or null when either endpoint is missing. */
export function phaseWeightDelta(r: PhaseReport): number | null {
  return r.start_weight_kg != null && r.end_weight_kg != null
    ? r.end_weight_kg - r.start_weight_kg
    : null;
}

function Row({ k, v }: { k: string; v: string | null }) {
  if (v == null) return null;
  return (
    <div className="phase-report-row">
      <span className="phase-report-k">{k}</span>
      <span className="phase-report-v mono">{v}</span>
    </div>
  );
}

function SheetInner({ report: r, closing, onClose }: { report: PhaseReport; closing: boolean; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, onClose);
  const { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  const delta = phaseWeightDelta(r);
  const arrow = delta == null ? "" : delta < 0 ? "▼" : "▲";
  const signed = (v: number, digits: 1 | 2 = 2) => `${v < 0 ? "−" : "+"}${(digits === 1 ? fmt1 : fmt2)(Math.abs(v))}`;

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet phase-report-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label={`${phaseKindLabel(r.phase_kind)} retrospective`}
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
          <span className="settings-sheet-title">{phaseKindLabel(r.phase_kind)} · {phaseSpanLabel(r.start_date, r.end_date)}</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body phase-report-body">
          <span className="phase-report-window">
            {r.active_days} days · {r.logged_days} logged
          </span>

          {delta != null && r.start_weight_kg != null && r.end_weight_kg != null && (
            <div className="phase-report-hero">
              <span className="phase-report-hero-delta mono">
                {arrow}{fmt1(Math.abs(delta))}<span className="phase-report-hero-u"> kg</span>
              </span>
              <span className="phase-report-hero-sub mono">
                {fmt1(r.start_weight_kg)} → {fmt1(r.end_weight_kg)} kg
              </span>
            </div>
          )}

          <div className="phase-report-rows">
            <Row
              k="Body fat"
              v={
                r.start_body_fat_pct != null && r.end_body_fat_pct != null
                  ? `${fmt1(r.start_body_fat_pct)} → ${fmt1(r.end_body_fat_pct)}%`
                  : null
              }
            />
            <Row
              k="Pace"
              v={
                r.observed_rate_kg_wk != null
                  ? `${signed(r.observed_rate_kg_wk)} kg/wk${r.planned_rate_kg_wk != null ? ` · plan ${signed(r.planned_rate_kg_wk)}` : ""}`
                  : null
              }
            />
            <Row
              k="Adherence"
              v={
                r.logged_days > 0
                  ? `${Math.round((r.adherent_days / r.logged_days) * 100)}% · ${r.adherent_days}/${r.logged_days} days`
                  : null
              }
            />
            <Row
              k="Avg intake"
              v={
                r.avg_calories != null
                  ? `${fmt0(r.avg_calories)} kcal${r.avg_calorie_target != null ? ` · target ${fmt0(r.avg_calorie_target)}` : ""}`
                  : null
              }
            />
            <Row k="Avg protein" v={r.avg_protein != null ? `${fmt0(r.avg_protein)} g` : null} />
            <Row
              k="TDEE assumed → measured"
              v={
                r.assumed_tdee != null && r.measured_tdee != null
                  ? `${fmt0(r.assumed_tdee)} → ${fmt0(r.measured_tdee)} kcal`
                  : null
              }
            />
            <Row
              k="Weekly volume"
              v={
                r.volume_start_kg_wk != null && r.volume_end_kg_wk != null
                  ? `${fmt0(r.volume_start_kg_wk)} → ${fmt0(r.volume_end_kg_wk)} kg`
                  : null
              }
            />
          </div>

          {/* The energy-model read assumes the logged days tell the whole story —
              coverage is right above, so the reader can weigh it themselves. */}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function PhaseReportSheet({
  report,
  open,
  onClose,
}: {
  report: PhaseReport | null;
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted || !report) return null;
  return <SheetInner report={report} closing={closing} onClose={onClose} />;
}
