import { useRef } from "react";
import { createPortal } from "react-dom";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useFocusTrap } from "@shared/hooks/useFocusTrap";
import { useSheetSwipe } from "@shared/hooks/useSheetSwipe";
import { timelineDate } from "@shared/lib/date";
import type { WeeklyVolumeTrendPoint } from "./logic";

const fmtKg = (v: number) => Math.round(v).toLocaleString();

function SheetInner({
  points,
  avgWeekKg,
  closing,
  onClose,
}: {
  points: WeeklyVolumeTrendPoint[];
  avgWeekKg: number;
  closing: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useFocusTrap(sheetRef, onClose);
  const { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragCancel } =
    useSheetSwipe(sheetRef, onClose);

  const max = Math.max(...points.map((p) => p.kg), 1);
  const latest = points[points.length - 1];
  const peakKg = Math.max(...points.map((p) => p.kg), 0);
  const loggedCount = points.filter((p) => p.logged).length;
  const first = points.length ? timelineDate(points[0].weekStart) : null;
  const last = latest ? timelineDate(latest.weekStart) : null;

  return createPortal(
    <>
      <div className={`settings-backdrop${closing ? " is-closing" : ""}`} onClick={onClose} />
      <div
        ref={sheetRef}
        className={`settings-sheet trend-sheet${closing ? " is-closing" : ""}`}
        role="dialog"
        aria-modal
        aria-label="Weekly volume trend"
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
          <span className="settings-sheet-title">Weekly Volume</span>
          <button className="settings-sheet-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-sheet-body trend-sheet-body">
          {points.length < 2 ? (
            <p className="trend-empty">
              Just getting started — the volume trend appears once a couple of
              training weeks are behind you.
            </p>
          ) : (
            <>
              <div className="trend-meta-row">
                <span className="trend-window">Last {points.length} weeks</span>
                <span className="trend-count">{loggedCount} logged</span>
              </div>

              {/* Maintained weekly totals (沒記就是維持 — same numbers the
                  headline averages). Weeks with no log at all are dimmed:
                  maintained, not recorded. */}
              <div>
                <div
                  className="wvt-bars"
                  role="img"
                  aria-label={`Weekly training volume, last ${points.length} weeks, ${fmtKg(latest.kg)} kg most recently`}
                >
                  {points.map((p) => (
                    <div
                      key={p.weekStart}
                      className={`wvt-bar${p.logged ? "" : " wvt-bar--carried"}`}
                      style={{ height: `${Math.max((p.kg / max) * 100, 1.5)}%` }}
                    />
                  ))}
                </div>
                {first && last && (
                  <div className="wvt-axis mono">
                    <span>{first.mon} {first.day}</span>
                    <span>{last.mon} {last.day}</span>
                  </div>
                )}
                <div className="wvt-legend">
                  <span className="wvt-legend-swatch" aria-hidden /> logged
                  <span className="wvt-legend-swatch wvt-legend-swatch--carried" aria-hidden /> carried forward
                </div>
              </div>

              <div className="trend-stats">
                <div className="trend-stat">
                  <span className="trend-stat-k">Latest week</span>
                  <span className="trend-stat-v">
                    {fmtKg(latest.kg)} <span className="trend-stat-u">kg</span>
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">4-wk avg</span>
                  <span className="trend-stat-v">
                    {fmtKg(avgWeekKg)} <span className="trend-stat-u">kg</span>
                  </span>
                </div>
                <div className="trend-stat">
                  <span className="trend-stat-k">Peak week</span>
                  <span className="trend-stat-v">
                    {fmtKg(peakKg)} <span className="trend-stat-u">kg</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* Weekly-volume trend — tap the card's eyebrow (chart glyph cue) to open.
   Bars are maintained weekly totals over the last ≤12 completed weeks; no
   target corridor, per the trend-sheet convention. */
export function WeeklyVolumeTrendSheet({
  points,
  avgWeekKg,
  open,
  onClose,
}: {
  points: WeeklyVolumeTrendPoint[];
  avgWeekKg: number;
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = useExitTransition(open);
  if (!mounted) return null;
  return <SheetInner points={points} avgWeekKg={avgWeekKg} closing={closing} onClose={onClose} />;
}
