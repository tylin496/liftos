import { useEffect, useRef, useState } from "react";
import { type StagnationView, type TrendResult, fmtInspectorDate } from "./logic";

const TREND_ARROWS: Record<string, string> = {
  recovering: "↑",
  stable: "→",
  declining: "↓",
  uncertain: "⚠",
};
const TREND_LABELS: Record<string, string> = {
  recovering: "Recovering",
  stable: "Stable",
  declining: "Declining",
  uncertain: "Data Check",
};

function AnimatedNumber({
  value,
  decimals = 0,
  trimZeros = false,
}: {
  value: number;
  decimals?: number;
  trimZeros?: boolean;
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (from === to || reduce) {
      setDisplay(to);
      return;
    }
    const dur = 480;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplay(to);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  const text = display.toFixed(decimals);
  return <>{trimZeros ? text.replace(/\.0+$/, "") : text}</>;
}

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
  const { pct, status, showPR, prLabel, label, expandable, t } = view;
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
        <span className="stagnation-pct">
          {showPR ? (
            prLabel
          ) : (
            <>
              <AnimatedNumber value={pct * 100} decimals={1} trimZeros />% of PR
            </>
          )}
        </span>
        {expandable && <span className="stagnation-expand-hint" aria-hidden="true" />}
      </span>
      {t && (
        <span className={`stagnation-trend stagnation-trend-${t.trend}`}>
          {TREND_ARROWS[t.trend]} {TREND_LABELS[t.trend]}
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
      {(t as TrendResult | null)?.trend === "uncertain" &&
        (t as TrendResult).refDate &&
        (t as TrendResult).lastDate && (
          <div className="data-check-detail">
            <span className="data-check-label">Jump detected</span>
            <span className="data-check-row">
              <span className="data-check-dates">
                {fmtInspectorDate((t as TrendResult).refDate!)} →{" "}
                {fmtInspectorDate((t as TrendResult).lastDate!)}
              </span>
              <span className="data-check-pct">
                {Math.round(Math.abs((t as TrendResult).change) * 100)}%
              </span>
            </span>
          </div>
        )}
    </>
  );
}
