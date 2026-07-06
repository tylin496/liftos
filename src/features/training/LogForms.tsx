import { useEffect, useRef, useState } from "react";
import { supabase } from "@shared/lib/supabase";
import { parse, normalize, score } from "./parser";
import type { TrainingLog } from "./api";
import { fmtWeightNum, isLbUnit } from "./ExprDisplay";
import {
  MIN_SET_COUNT,
  LAST_BW_KEY,
  todayStr,
  heroInputStyle,
  emptyRepValues,
  repsStringToValues,
  composeRepsMulti,
  useScrollAboveKeyboard,
  useWeightAdjuster,
  useAssistAdjuster,
} from "./logFormHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// RepsSetInput
// ─────────────────────────────────────────────────────────────────────────────

function RepsSetInput({
  setCount,
  values,
  onChange,
  onLastEnter,
  defaultRep,
  hero,
}: {
  setCount: number;
  values: string[];
  onChange: (v: string[]) => void;
  onLastEnter?: () => void;
  defaultRep?: string;
  hero?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const n = Math.max(MIN_SET_COUNT, setCount);

  function placeholderFor(i: number) {
    // First, try to use the value from the previous set
    for (let j = i - 1; j >= 0; j--) {
      const p = (values[j] ?? "").trim();
      if (p) return p;
    }
    // Fall back to defaultRep (from previous log)
    if (defaultRep) return defaultRep;
    // No value to suggest
    return "";
  }

  function setAt(i: number, raw: string) {
    const v = raw.replace(/\D/g, "");
    const next = values.slice();
    next[i] = v;
    onChange(next);
  }

  function onKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i < n - 1) refs.current[i + 1]?.focus();
    else onLastEnter?.();
  }

  return (
    <div className={`reps-triple${hero ? " hero" : ""}`} role="group" aria-label="Reps per set">
      {Array.from({ length: n }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="reps-input mono"
          value={values[i] ?? ""}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          placeholder={placeholderFor(i) || "6"}
          aria-label={`Set ${i + 1} reps`}
          autoComplete="off"
          inputMode="numeric"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditSecondaryActions — small text links under the submit button, matching the
// Nutrition Save-entry form: Delete on the left (optimistic + Undo toast),
// Cancel on the right. Replaces the old ✕ dismiss button.
// ─────────────────────────────────────────────────────────────────────────────

function EditSecondaryActions({ onDelete, onCancel }: { onDelete?: () => void; onCancel: () => void }) {
  return (
    <div className="log-secondary">
      {onDelete && (
        <button type="button" className="log-delete-link" onClick={onDelete}>
          Delete entry
        </button>
      )}
      <button type="button" className="log-cancel-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddEntryForm
// ─────────────────────────────────────────────────────────────────────────────

export function AddEntryForm({
  setCount,
  lastRaw,
  onAdd,
  onCancel,
  submitting = false,
}: {
  setCount: number;
  lastRaw: string;
  onAdd: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const n = Math.max(MIN_SET_COUNT, setCount);
  const lastParsed = lastRaw ? parse(lastRaw) : null;
  const [weightExpr, setWeightExpr] = useState(lastParsed?.weightExpr ?? "");
  const defaultRep = lastParsed?.reps ? String(lastParsed.reps).split(/[/\-]/)[0] ?? "" : "";
  const [repValues, setRepValues] = useState(() => emptyRepValues(n));
  const [unit, setUnit] = useState<"kg" | "lbs">(isLbUnit(lastParsed?.unit) ? "lbs" : "kg");
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  const suffix = unit === "lbs" ? " lbs" : "";
  const reps = composeRepsMulti(repValues, defaultRep);
  const effectiveWeightExpr = weightExpr.trim() || (lastParsed?.weightExpr ?? "");
  const raw =
    effectiveWeightExpr && reps
      ? normalize(`${effectiveWeightExpr}${suffix} *${reps}`)
      : "";
  const preview = raw ? parse(raw) : null;
  const isValid = preview != null && score(preview) > 0;
  const { weightRef, adjustWeight } = useWeightAdjuster(
    weightExpr,
    setWeightExpr,
    preview?.weight,
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    onAdd(raw, date, note.trim());
    setWeightExpr("");
    setRepValues(emptyRepValues(n));
    setNote("");
  }

  const isToday = date === todayStr();

  return (
    <form className="add-form log-redesign" ref={formRef} onSubmit={submit}>
      <div className="log-topbar">
        <input
          type="date"
          className="log-date-chip"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          style={isToday ? { opacity: 0.45 } : {}}
        />
      </div>

      <div className="log-weight-zone">
        <div className="log-hero-row">
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustWeight(-2.5)}
            aria-label="−2.5"
          >
            −
          </button>
          <input
            ref={weightRef}
            autoFocus
            className="log-hero-input mono"
            style={heroInputStyle(weightExpr)}
            value={weightExpr}
            onChange={(e) => setWeightExpr(e.target.value)}
            placeholder={lastParsed?.weightExpr ?? "0"}
            aria-label="Weight"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
          />
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustWeight(+2.5)}
            aria-label="+2.5"
          >
            +
          </button>
        </div>
        <div className="log-unit-row">
          <div className="unit-toggle" role="group" aria-label="Unit">
            <button
              type="button"
              className={`unit-btn${unit === "kg" ? " on" : ""}`}
              onClick={() => setUnit("kg")}
            >
              kg
            </button>
            <button
              type="button"
              className={`unit-btn${unit === "lbs" ? " on" : ""}`}
              onClick={() => setUnit("lbs")}
            >
              lb
            </button>
          </div>
        </div>
      </div>

      <div className="log-reps-zone">
        <div className="log-reps-label">Reps per set</div>
        <RepsSetInput
          setCount={n}
          values={repValues}
          onChange={setRepValues}
          onLastEnter={() => formRef.current?.requestSubmit()}
          defaultRep={defaultRep}
          hero
        />
      </div>

      <input
        className="log-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="Note"
      />

      <button type="submit" className="btn-log-primary" disabled={!isValid || submitting}>
        {submitting ? "Saving…" : "Log set"}
      </button>
      <div className="log-secondary">
        <button type="button" className="log-cancel-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddAssistedForm
// ─────────────────────────────────────────────────────────────────────────────

export function AddAssistedForm({
  setCount,
  lastLog,
  onAdd,
  onCancel,
  submitting = false,
}: {
  setCount: number;
  lastLog: TrainingLog | null;
  onAdd: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const n = Math.max(MIN_SET_COUNT, setCount);
  const lastParsed = lastLog?.raw ? parse(lastLog.raw) : null;
  const lastAssist = lastParsed?.assisted?.assist ?? null;

  const [assistance, setAssistance] = useState(lastAssist != null ? String(lastAssist) : "");
  // Prefer the latest Health measurement (fetched below); seed from the last
  // bodyweight entered on a prior assisted set so logging isn't blocked when
  // Health has no weight yet.
  const [bodyweight, setBodyweight] = useState(
    () => localStorage.getItem(LAST_BW_KEY) ?? "",
  );
  // True once Health supplied the weight. The field is locked (read-only) only
  // then — Health stays authoritative when present, but degrades to manual entry
  // when there's no Health data, so a first-ever assisted log isn't blocked.
  const [bwFromHealth, setBwFromHealth] = useState(false);
  const [repValues, setRepValues] = useState(() => emptyRepValues(n));
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  useEffect(() => {
    supabase
      .from("health_metrics")
      .select("weight_kg, metric_date")
      .not("weight_kg", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.weight_kg) {
          setBodyweight(String(data.weight_kg));
          setBwFromHealth(true);
        }
      });
  }, []);

  const parsedAssist = parseFloat(assistance) || 0;
  const parsedBw = parseFloat(bodyweight) || 0;
  const effectiveLoad =
    parsedBw > 0 && parsedAssist > 0 ? +(parsedBw - parsedAssist).toFixed(2) : null;
  const reps = composeRepsMulti(repValues, "");
  const isValid = effectiveLoad !== null && effectiveLoad > 0 && reps.length > 0;
  const { assistRef, adjustAssist } = useAssistAdjuster(setAssistance, parsedAssist);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || effectiveLoad === null || submitting) return;
    localStorage.setItem(LAST_BW_KEY, String(parsedBw));
    const raw = normalize(`${parsedBw}-(${parsedAssist}) *${reps}`);
    onAdd(raw, date, note.trim());
    setAssistance("");
    setRepValues(emptyRepValues(n));
    setNote("");
  }

  const isToday = date === todayStr();

  return (
    <form className="add-form log-redesign" ref={formRef} onSubmit={submit}>
      <div className="log-topbar">
        <input
          type="date"
          className="log-date-chip"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          style={isToday ? { opacity: 0.45 } : {}}
        />
      </div>

      <div className="log-weight-zone">
        <div className="log-assisted-label">Assistance</div>
        <div className="log-hero-row">
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustAssist(-2.5)}
            aria-label="−2.5"
          >
            −
          </button>
          <input
            ref={assistRef}
            autoFocus
            className="log-hero-input mono"
            style={heroInputStyle(assistance)}
            value={assistance}
            onChange={(e) => setAssistance(e.target.value)}
            placeholder="0"
            aria-label="Assistance kg"
            inputMode="text"
            autoComplete="off"
          />
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustAssist(+2.5)}
            aria-label="+2.5"
          >
            +
          </button>
        </div>
        <div className="log-bw-row">
          <label className="log-bw-label">
            {bwFromHealth ? "Bodyweight" : "Bodyweight (manual)"}
          </label>
          <input
            className={`log-bw-input mono${bwFromHealth ? " log-bw-input--static" : ""}`}
            value={bodyweight}
            onChange={(e) => setBodyweight(e.target.value)}
            readOnly={bwFromHealth}
            tabIndex={bwFromHealth ? -1 : undefined}
            placeholder="0"
            aria-label={
              bwFromHealth
                ? "Bodyweight kg (from latest Health measurement)"
                : "Bodyweight kg"
            }
            inputMode={bwFromHealth ? "none" : "decimal"}
            autoComplete="off"
          />
          <span className="log-bw-unit">kg</span>
        </div>
      </div>

      <div className="log-reps-zone">
        <div className="log-reps-label">Reps per set</div>
        <RepsSetInput
          setCount={n}
          values={repValues}
          onChange={setRepValues}
          onLastEnter={() => formRef.current?.requestSubmit()}
          hero
        />
      </div>

      {isValid && effectiveLoad !== null && reps ? (
        <div className="log-preview-bar">
          <span className="mono">
            <strong>{fmtWeightNum(effectiveLoad)} kg</strong>
            <span className="expr-sep"> ×{reps}</span>
            <span className="log-assist-preview"> ({parsedAssist} kg assist)</span>
          </span>
        </div>
      ) : null}

      <input
        className="log-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="Note"
      />

      <button type="submit" className="btn-log-primary" disabled={!isValid || submitting}>
        {submitting ? "Saving…" : "Log set"}
      </button>
      <div className="log-secondary">
        <button type="button" className="log-cancel-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineEditEntry
// ─────────────────────────────────────────────────────────────────────────────

export function InlineEditEntry({
  log,
  setCount,
  onSave,
  onCancel,
  onDelete,
}: {
  log: TrainingLog;
  setCount: number;
  onSave: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const initial = log.raw ? parse(log.raw) : null;
  const segCount = initial?.reps ? String(initial.reps).split(/[/\-]/).length : 0;
  const n = Math.max(MIN_SET_COUNT, setCount, segCount);
  const [weightExpr, setWeightExpr] = useState(initial?.weightExpr ?? "");
  const [repValues, setRepValues] = useState(() =>
    repsStringToValues(initial?.reps ?? "", n),
  );
  const [unit, setUnit] = useState<"kg" | "lbs">(
    isLbUnit(initial?.unit) ? "lbs" : "kg",
  );
  const [note, setNote] = useState(log.note ?? "");
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  const suffix = unit === "lbs" ? " lbs" : "";
  const reps = composeRepsMulti(repValues, "");
  const raw =
    weightExpr.trim() && reps
      ? normalize(`${weightExpr.trim()}${suffix} *${reps}`)
      : "";
  const preview = raw ? parse(raw) : null;
  const isValid = preview != null && score(preview) > 0;
  const { weightRef, adjustWeight } = useWeightAdjuster(
    weightExpr,
    setWeightExpr,
    preview?.weight,
  );

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSave(raw, log.log_date ?? "", note.trim());
  }

  return (
    <form className="add-form log-redesign log-edit" ref={formRef} onSubmit={save}>
      <div className="log-weight-zone">
        <div className="log-hero-row">
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustWeight(-2.5)}
            aria-label="−2.5"
          >
            −
          </button>
          <input
            ref={weightRef}
            className="log-hero-input mono"
            style={heroInputStyle(weightExpr)}
            value={weightExpr}
            onChange={(e) => setWeightExpr(e.target.value)}
            autoFocus
            placeholder="0"
            aria-label="Weight"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
          />
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustWeight(+2.5)}
            aria-label="+2.5"
          >
            +
          </button>
        </div>
        <div className="log-unit-row">
          <div className="unit-toggle" role="group" aria-label="Unit">
            <button
              type="button"
              className={`unit-btn${unit === "kg" ? " on" : ""}`}
              onClick={() => setUnit("kg")}
            >
              kg
            </button>
            <button
              type="button"
              className={`unit-btn${unit === "lbs" ? " on" : ""}`}
              onClick={() => setUnit("lbs")}
            >
              lb
            </button>
          </div>
        </div>
      </div>

      <div className="log-reps-zone">
        <div className="log-reps-label">Reps per set</div>
        <RepsSetInput
          setCount={n}
          values={repValues}
          onChange={setRepValues}
          onLastEnter={() => formRef.current?.requestSubmit()}
          hero
        />
      </div>

      <input
        className="log-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="Note"
      />

      <div className="log-edit-actions">
        <button type="submit" className="btn-log-primary" disabled={!isValid}>
          Save changes
        </button>
      </div>
      <EditSecondaryActions onDelete={onDelete} onCancel={onCancel} />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineEditAssistedEntry
// ─────────────────────────────────────────────────────────────────────────────

export function InlineEditAssistedEntry({
  log,
  setCount,
  onSave,
  onCancel,
  onDelete,
}: {
  log: TrainingLog;
  setCount: number;
  onSave: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const initial = log.raw ? parse(log.raw) : null;
  const segCount = initial?.reps ? String(initial.reps).split(/[/\-]/).length : 0;
  const n = Math.max(MIN_SET_COUNT, setCount, segCount);
  const [assistance, setAssistance] = useState(
    String(initial?.assisted?.assist ?? log.assistance ?? ""),
  );
  const [bodyweight, setBodyweight] = useState(
    String(initial?.assisted?.bw ?? log.bodyweight ?? ""),
  );
  const [repValues, setRepValues] = useState(() =>
    repsStringToValues(initial?.reps ?? log.reps ?? "", n),
  );
  const [note, setNote] = useState(log.note ?? "");
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  const parsedAssist = parseFloat(assistance) || 0;
  const parsedBw = parseFloat(bodyweight) || 0;
  const effectiveLoad =
    parsedBw > 0 && parsedAssist > 0 ? +(parsedBw - parsedAssist).toFixed(2) : null;
  const reps = composeRepsMulti(repValues, "");
  const isValid = effectiveLoad !== null && effectiveLoad > 0 && reps.length > 0;
  const { assistRef, adjustAssist } = useAssistAdjuster(setAssistance, parsedAssist);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    const raw = normalize(`${parsedBw}-(${parsedAssist}) *${reps}`);
    onSave(raw, log.log_date ?? "", note.trim());
  }

  return (
    <form className="add-form log-redesign log-edit" ref={formRef} onSubmit={save}>
      <div className="log-weight-zone">
        <div className="log-assisted-label">Assistance</div>
        <div className="log-hero-row">
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustAssist(-2.5)}
            aria-label="−2.5"
          >
            −
          </button>
          <input
            ref={assistRef}
            className="log-hero-input mono"
            style={heroInputStyle(assistance)}
            value={assistance}
            onChange={(e) => setAssistance(e.target.value)}
            placeholder="0"
            aria-label="Assistance kg"
            inputMode="text"
            autoComplete="off"
            autoFocus
          />
          <button
            type="button"
            className="log-adj-btn"
            onClick={() => adjustAssist(+2.5)}
            aria-label="+2.5"
          >
            +
          </button>
        </div>
        <div className="log-bw-row">
          <label className="log-bw-label">Bodyweight</label>
          <input
            className="log-bw-input mono"
            value={bodyweight}
            onChange={(e) => setBodyweight(e.target.value)}
            placeholder="0"
            aria-label="Bodyweight kg"
            inputMode="text"
            autoComplete="off"
          />
          <span className="log-bw-unit">kg</span>
        </div>
      </div>

      <div className="log-reps-zone">
        <div className="log-reps-label">Reps per set</div>
        <RepsSetInput
          setCount={n}
          values={repValues}
          onChange={setRepValues}
          onLastEnter={() => formRef.current?.requestSubmit()}
          hero
        />
      </div>

      {isValid && effectiveLoad !== null && reps ? (
        <div className="log-preview-bar">
          <span className="mono">
            <strong>{fmtWeightNum(effectiveLoad)} kg</strong>
            <span className="expr-sep"> ×{reps}</span>
            <span className="log-assist-preview"> ({parsedAssist} kg assist)</span>
          </span>
        </div>
      ) : null}

      <input
        className="log-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="Note"
      />

      <div className="log-edit-actions">
        <button type="submit" className="btn-log-primary" disabled={!isValid}>
          Save changes
        </button>
      </div>
      <EditSecondaryActions onDelete={onDelete} onCancel={onCancel} />
    </form>
  );
}
