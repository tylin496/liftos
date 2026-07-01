import type { CSSProperties } from "react";
import "./segmentedControl.css";

export interface SegmentedOption {
  id: string;
  label: string;
  count?: number;
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const idx = options.findIndex((o) => o.id === value);
  return (
    <div
      className="seg"
      role="tablist"
      style={{ "--seg-idx": Math.max(0, idx), "--seg-n": options.length } as CSSProperties}
    >
      <span className="seg-thumb" aria-hidden />
      {options.map((opt) => (
        <button
          key={opt.id}
          role="tab"
          aria-selected={opt.id === value}
          className={`seg-item${opt.id === value ? " is-active" : ""}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
          {opt.count != null && opt.count > 0 && <span className="seg-count">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
