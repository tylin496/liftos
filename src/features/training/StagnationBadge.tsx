import { type StagnationView, fmtInspectorDate } from "./logic";
import { TrendIcon, type TrendDir } from "@shared/components/TrendIcon";

const TREND_DIRS: Record<string, TrendDir> = {
  recovering: "up",
  stable: "flat",
  declining: "down",
  uncertain: "alert",
};
const TREND_LABELS: Record<string, string> = {
  recovering: "Recovering",
  stable: "Stable",
  declining: "Declining",
  uncertain: "Data Check",
};


export function StagnationBadge({
  view,
  open,
  onToggle,
}: {
  view: StagnationView | null;
  open: boolean;
  onToggle: () => void;
}) {
  if (!view) return null;
  const { status, showPR, prLabel, label, expandable, t } = view;
  return (
    <div
      className={`stagnation-badge stagnation-${status}${showPR ? " stagnation-at-pr" : ""}${expandable ? " stagnation-expandable" : ""}`}
      onClick={expandable ? onToggle : undefined}
      role={expandable ? "button" : undefined}
      aria-expanded={expandable ? open : undefined}
      tabIndex={expandable ? 0 : undefined}
      onKeyDown={
        expandable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      <span className="stagnation-head">
        <span className="stagnation-label">{label}</span>
        {showPR && <span className="stagnation-pct">{prLabel}</span>}
        {expandable && <span className="stagnation-expand-hint" aria-hidden="true" />}
      </span>
      {t && (
        <span className={`stagnation-trend stagnation-trend-${t.trend}`}>
          <TrendIcon dir={TREND_DIRS[t.trend]} />
          {TREND_LABELS[t.trend]}
        </span>
      )}
    </div>
  );
}

export function StagnationDetail({
  view,
  open,
}: {
  view: StagnationView | null;
  open: boolean;
}) {
  if (!view) return null;
  const { status, prFmt, prDate, reason, needsExplaining, t } = view;
  return (
    <>
      {!open && needsExplaining && reason && (
        <div className={`stagnation-hint stagnation-hint-${status}`}>{reason}</div>
      )}
      {open && prFmt && (
        <div className={`stagnation-detail${reason ? " has-reason" : ""}`}>
          {reason && <span className="stagnation-reason">{reason}</span>}
          <span className="stagnation-baseline">
            <span className="baseline-label">{reason ? "vs baseline" : "Baseline"}</span>
            <span className="baseline-entry">{prFmt}</span>
            {prDate && <span className="baseline-date">{prDate}</span>}
          </span>
        </div>
      )}
      {t && t.trend === "uncertain" && t.refDate && t.lastDate && (
        <div className="data-check-detail">
          <span className="data-check-label">Jump detected</span>
          <span className="data-check-row">
            <span className="data-check-dates">
              {fmtInspectorDate(t.refDate)} → {fmtInspectorDate(t.lastDate)}
            </span>
            <span className="data-check-pct">{Math.round(Math.abs(t.change) * 100)}%</span>
          </span>
        </div>
      )}
    </>
  );
}
