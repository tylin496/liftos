import type { ReactNode } from "react";
import { parse, score, formatRepsDisplay } from "./parser";

export function fmtWeightNum(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}

export function isLbUnit(unit: string | null | undefined) {
  return unit === "lbs" || unit === "lb";
}

function fmtKgFromLb(n: number): string {
  return parseFloat((n * 0.453592).toFixed(2)).toString();
}

interface ExprDisplayProps {
  raw: string | null;
  resultOnly?: boolean;
  detail?: boolean;
  histMode?: boolean;
  /** Rendered right after the primary weight so it wraps with it — the
   * converted-kg detail wraps away to its own line first, not the badge. */
  badge?: ReactNode;
}

export function ExprDisplay({ raw, resultOnly, detail, histMode, badge }: ExprDisplayProps) {
  if (!raw) return <span className="expr-bad">—</span>;
  const parsed = parse(raw);
  if (!parsed) return <span className="expr-bad">{raw}</span>;

  const { weightExpr, weight, reps, unit, assisted } = parsed;

  if (resultOnly && Number.isFinite(weight)) {
    if (isLbUnit(unit)) {
      return (
        <span className="expr expr-result-only">
          <strong className="expr-weight-primary">{weight}</strong>
          <span className="expr-unit-tag primary-unit">lb</span>
          <span className="expr-star">×</span>
          <span className="expr-reps">{formatRepsDisplay(reps)}</span>
          <span className="expr-kg-hint">≈ {fmtKgFromLb(weight)} kg</span>
        </span>
      );
    }
    return (
      <span className="expr expr-result-only">
        <strong className="expr-weight-primary">{fmtWeightNum(weight)}</strong>
        <span className="expr-unit-tag primary-unit">kg</span>
        <span className="expr-star">×</span>
        <span className="expr-reps">{formatRepsDisplay(reps)}</span>
      </span>
    );
  }

  if (histMode && Number.isFinite(weight)) {
    const isSimple = /^[+-]?\d+(?:\.\d+)?$/.test(String(weightExpr ?? "").trim()) && !isLbUnit(unit);
    if (isLbUnit(unit)) {
      return (
        <span className="expr expr-result-only">
          <strong className="expr-weight-primary">{weight}</strong>
          <span className="expr-unit-tag primary-unit">lb</span>
          <span className="expr-star">×</span>
          <span className="expr-reps">{formatRepsDisplay(reps)}</span>
          <span className="expr-kg-hint">≈ {fmtKgFromLb(weight)} kg</span>
        </span>
      );
    }
    if (isSimple) {
      return (
        <span className="expr expr-result-only">
          <strong className="expr-weight-primary">{fmtWeightNum(weight)}</strong>
          <span className="expr-unit-tag primary-unit">kg</span>
          <span className="expr-star">×</span>
          <span className="expr-reps">{formatRepsDisplay(reps)}</span>
        </span>
      );
    }
    return (
      <span className="expr expr-result-only expr-wrap-badge">
        <span className="expr-weight-primary">{weightExpr}</span>
        {badge}
        <span className="expr-unit-tag"> = {fmtWeightNum(weight)} kg</span>
        <span className="expr-star">×</span>
        <span className="expr-reps">{formatRepsDisplay(reps)}</span>
      </span>
    );
  }

  if (assisted && !detail) {
    const w = fmtWeightNum(score(parsed));
    return (
      <span className="expr">
        <span className="expr-raw">
          {fmtWeightNum(assisted.assist)}×{formatRepsDisplay(reps)} = {w} kg
        </span>
      </span>
    );
  }

  const simpleKg =
    /^[+-]?\d+(?:\.\d+)?$/.test(String(weightExpr ?? "").trim()) && !isLbUnit(unit);

  return (
    <span className="expr">
      <span className="expr-raw">
        {simpleKg ? (
          <strong className="expr-weight-primary">{weightExpr}</strong>
        ) : (
          weightExpr
        )}
        {unit ? (
          <span className={`expr-unit-tag${simpleKg ? " primary-unit" : ""}`}>{unit}</span>
        ) : null}
        <span className="expr-star">×</span>
        <span className="expr-reps">{formatRepsDisplay(reps)}</span>
      </span>
      {assisted && detail && (
        <span className="expr-eq">
          <span> = {fmtWeightNum(score(parsed))} kg lifted</span>
        </span>
      )}
      {isLbUnit(unit) && (
        <strong className="expr-result expr-eq"> ≈ {fmtKgFromLb(weight)} kg</strong>
      )}
    </span>
  );
}
