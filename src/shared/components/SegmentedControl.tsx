import type { CSSProperties } from "react";
import "./segmentedControl.css";

export interface SegmentedOption {
  id: string;
  label: string;
  count?: number;
  /** Prefix ✓ — "this one was completed last" (e.g. most recent trained split). */
  marked?: boolean;
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

  // Roving tabindex + arrow-key navigation — the behaviour role="tablist"
  // advertises to assistive tech. Without it, AT tells the user to expect
  // arrow-key movement across a single tab-stop, but every tab was an
  // independent Tab-stop and arrows did nothing.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const cur = Math.max(0, idx);
    let next = cur;
    if (e.key === "ArrowLeft") next = (cur - 1 + options.length) % options.length;
    else if (e.key === "ArrowRight") next = (cur + 1) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    else return;
    e.preventDefault();
    const opt = options[next];
    if (!opt) return;
    onChange(opt.id);
    e.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <div
      className="seg"
      role="tablist"
      onKeyDown={onKeyDown}
      style={{ "--seg-idx": Math.max(0, idx), "--seg-n": options.length } as CSSProperties}
    >
      <span className="seg-thumb" aria-hidden />
      {options.map((opt) => (
        <button
          key={opt.id}
          role="tab"
          aria-selected={opt.id === value}
          tabIndex={opt.id === value ? 0 : -1}
          className={`seg-item${opt.id === value ? " is-active" : ""}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.marked && (
            <span className="seg-check" aria-hidden>
              ✓
            </span>
          )}
          {opt.label}
          {opt.count != null && opt.count > 0 && <span className="seg-count">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}
