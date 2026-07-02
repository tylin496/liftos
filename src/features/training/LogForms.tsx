import { useEffect, useRef, useState } from "react";
import { supabase } from "@shared/lib/supabase";
import { parse, normalize, score } from "./parser";
import type { TrainingLog } from "./api";
import { ExprDisplay, fmtWeightNum, isLbUnit } from "./ExprDisplay";
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
          placeholder={placeholderFor(i) || String(i + 1)}
          aria-label={`Set ${i + 1} reps`}
          autoComplete="off"
          inputMode="numeric"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditAdvancedActions
// ─────────────────────────────────────────────────────────────────────────────

function EditAdvancedActions({ onDelete }: { onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!onDelete) return null;
  return (
    <div className="log-edit-advanced">
      <button
        type="button"
        className="log-edit-advanced-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Advanced <span className={`caret${open ? " open" : ""}`}>▾</span>
      </button>
      {open && (
        <button type="button" className="inline-edit-delete-btn" onClick={onDelete}>
          Delete entry
        </button>
      )}
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
  const { weightRef, adjustWeight, appendToken } = useWeightAdjuster(
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
        <button type="button" className="log-dismiss" onClick={onCancel} aria-label="Dismiss">
          ✕
        </button>
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
            ref={(node) => {
              weightRef.current = node;
              if (node && !(node as HTMLInputElement & { _f?: boolean })._f) {
                (node as HTMLInputElement & { _f?: boolean })._f = true;
                node.focus();
              }
            }}
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
        <div className="chip-row log-chips">
          {["+0.625", "+1.25", "+2.1", "+2.5", "×2"].map((tok) => (
            <button key={tok} type="button" className="chip" onClick={() => appendToken(tok)}>
              {tok}
            </button>
          ))}
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

      {weightExpr || reps ? (
        <div className="log-preview-bar">
          {isValid ? (
            <ExprDisplay raw={raw} detail />
          ) : (
            <span className="expr-bad">
              {!effectiveWeightExpr
                ? "enter weight"
                : !reps
                  ? "enter reps"
                  : preview
                    ? "enter a weight above 0"
                    : "cannot parse"}
            </span>
          )}
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
  const [bodyweight, setBodyweight] = useState("");
  const [repValues, setRepValues] = useState(() => emptyRepValues(n));
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  // Bodyweight always reflects the latest Health measurement — it's not a
  // user-editable field, so there's no "touched" guard to protect here.
  useEffect(() => {
    supabase
      .from("health_metrics")
      .select("weight_kg, metric_date")
      .not("weight_kg", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.weight_kg) setBodyweight(String(data.weight_kg));
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
        <button type="button" className="log-dismiss" onClick={onCancel} aria-label="Dismiss">
          ✕
        </button>
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
            ref={(node) => {
              assistRef.current = node;
              if (node && !(node as HTMLInputElement & { _f?: boolean })._f) {
                (node as HTMLInputElement & { _f?: boolean })._f = true;
                node.focus();
              }
            }}
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
          <label className="log-bw-label">Bodyweight</label>
          <input
            className="log-bw-input log-bw-input--static mono"
            value={bodyweight}
            readOnly
            tabIndex={-1}
            placeholder="0"
            aria-label="Bodyweight kg (from latest Health measurement)"
            inputMode="none"
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
  const { weightRef, adjustWeight, appendToken } = useWeightAdjuster(
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
        <div className="chip-row log-chips">
          {["+0.625", "+1.25", "+2.1", "+2.5", "×2"].map((tok) => (
            <button key={tok} type="button" className="chip" onClick={() => appendToken(tok)}>
              {tok}
            </button>
          ))}
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

      {weightExpr || reps ? (
        <div className="log-preview-bar">
          {isValid ? (
            <ExprDisplay raw={raw} detail />
          ) : (
            <span className="expr-bad">{preview ? "enter a weight above 0" : "cannot parse"}</span>
          )}
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
        <button type="button" className="btn-log-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <EditAdvancedActions onDelete={onDelete} />
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
        <button type="button" className="btn-log-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <EditAdvancedActions onDelete={onDelete} />
    </form>
  );
}
