import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
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
// Shared form pieces — used by both the "Log set" (add) and "Edit entry" forms
// so the two surfaces stay identical. Each returns a single form-level child so
// the stagger (`.log-redesign > *`) and column gap are preserved.
// ─────────────────────────────────────────────────────────────────────────────

// Weight hero (± / value / ±) + kg·lb unit toggle. Normal (non-assisted) sets.
function WeightZone({
  weightRef,
  weightExpr,
  setWeightExpr,
  adjustWeight,
  unit,
  setUnit,
  placeholder = "0",
}: {
  weightRef: MutableRefObject<HTMLInputElement | null>;
  weightExpr: string;
  setWeightExpr: (v: string) => void;
  adjustWeight: (delta: number) => void;
  unit: "kg" | "lbs";
  setUnit: (u: "kg" | "lbs") => void;
  placeholder?: string;
}) {
  return (
    <div className="log-weight-zone">
      <div className="log-hero-row">
        <button type="button" className="log-adj-btn" onClick={() => adjustWeight(-2.5)} aria-label="−2.5">
          −
        </button>
        <input
          ref={weightRef}
          autoFocus
          className="log-hero-input mono"
          style={heroInputStyle(weightExpr)}
          value={weightExpr}
          onChange={(e) => setWeightExpr(e.target.value)}
          placeholder={placeholder}
          aria-label="Weight"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
        />
        <button type="button" className="log-adj-btn" onClick={() => adjustWeight(+2.5)} aria-label="+2.5">
          +
        </button>
      </div>
      <div className="log-unit-row">
        <div className="unit-toggle" role="group" aria-label="Unit">
          <button type="button" className={`unit-btn${unit === "kg" ? " on" : ""}`} onClick={() => setUnit("kg")}>
            kg
          </button>
          <button type="button" className={`unit-btn${unit === "lbs" ? " on" : ""}`} onClick={() => setUnit("lbs")}>
            lb
          </button>
        </div>
      </div>
    </div>
  );
}

// Assistance hero (± / value / ±) + bodyweight row. Assisted sets. When
// `bwFromHealth` the bodyweight field is a locked read-out of the latest Health
// weight; otherwise it's a manual entry (a first-ever assisted log, or an edit).
function AssistedWeightZone({
  assistRef,
  assistance,
  setAssistance,
  adjustAssist,
  bodyweight,
  setBodyweight,
  bwFromHealth = false,
}: {
  assistRef: MutableRefObject<HTMLInputElement | null>;
  assistance: string;
  setAssistance: (v: string) => void;
  adjustAssist: (delta: number) => void;
  bodyweight: string;
  setBodyweight: (v: string) => void;
  bwFromHealth?: boolean;
}) {
  return (
    <div className="log-weight-zone">
      <div className="log-assisted-label">Assistance</div>
      <div className="log-hero-row">
        <button type="button" className="log-adj-btn" onClick={() => adjustAssist(-2.5)} aria-label="−2.5">
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
        <button type="button" className="log-adj-btn" onClick={() => adjustAssist(+2.5)} aria-label="+2.5">
          +
        </button>
      </div>
      <div className="log-bw-row">
        <label className="log-bw-label">{bwFromHealth ? "Bodyweight" : "Bodyweight (manual)"}</label>
        <input
          className={`log-bw-input mono${bwFromHealth ? " log-bw-input--static" : ""}`}
          value={bodyweight}
          onChange={(e) => setBodyweight(e.target.value)}
          readOnly={bwFromHealth}
          tabIndex={bwFromHealth ? -1 : undefined}
          placeholder="0"
          aria-label={bwFromHealth ? "Bodyweight kg (from latest Health measurement)" : "Bodyweight kg"}
          inputMode={bwFromHealth ? "none" : "decimal"}
          autoComplete="off"
        />
        <span className="log-bw-unit">kg</span>
      </div>
    </div>
  );
}

// "Reps per set" label + the multi-set numeric inputs.
function RepsZone({
  setCount,
  values,
  onChange,
  onLastEnter,
  defaultRep,
}: {
  setCount: number;
  values: string[];
  onChange: (v: string[]) => void;
  onLastEnter: () => void;
  defaultRep?: string;
}) {
  return (
    <div className="log-reps-zone">
      <div className="log-reps-label">Reps per set</div>
      <RepsSetInput
        setCount={setCount}
        values={values}
        onChange={onChange}
        onLastEnter={onLastEnter}
        defaultRep={defaultRep}
        hero
      />
    </div>
  );
}

// Assisted preview: effective load × reps (assist). Renders nothing until valid.
function AssistedPreviewBar({ load, reps, assist }: { load: number | null; reps: string; assist: number }) {
  if (load === null || load <= 0 || !reps) return null;
  return (
    <div className="log-preview-bar">
      <span className="mono">
        <strong>{fmtWeightNum(load)} kg</strong>
        <span className="expr-sep"> ×{reps}</span>
        <span className="log-assist-preview"> ({assist} kg assist)</span>
      </span>
    </div>
  );
}

// Date chip + Bonus toggle — the add forms' top bar. Bonus marks a rest-day
// extra: the set's own volume counts, but the day is not a session of the
// split (no roster carry-forward, no rotation advance, still a rest day).
function LogTopbar({
  date,
  setDate,
  bonus,
  setBonus,
}: {
  date: string;
  setDate: (v: string) => void;
  bonus: boolean;
  setBonus: (v: boolean) => void;
}) {
  const isToday = date === todayStr();
  return (
    <div className="log-topbar">
      <input
        type="date"
        className={`log-date-chip${isToday ? " is-today" : ""}`}
        value={date}
        max={todayStr()}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
      />
      <button
        type="button"
        className={`log-bonus-chip${bonus ? " on" : ""}`}
        aria-pressed={bonus}
        aria-label="Bonus set — counts its volume only, not a session"
        onClick={() => setBonus(!bonus)}
      >
        Bonus
      </button>
    </div>
  );
}

// The note input (identical across every form).
function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      className="log-note"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="note (optional)"
      aria-label="Note"
    />
  );
}

// Primary submit + secondary text links. `onDelete` present → Delete on the
// left (edit forms); absent → just Cancel (add forms). One shared footer so the
// add and edit forms end identically.
function LogFormFooter({
  primaryLabel,
  submitting = false,
  disabled,
  onCancel,
  onDelete,
}: {
  primaryLabel: string;
  submitting?: boolean;
  disabled: boolean;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <div className="log-edit-actions">
        <button type="submit" className="btn-log-primary press-settle" disabled={disabled}>
          {submitting ? "Saving…" : primaryLabel}
        </button>
      </div>
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
    </>
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
  /** Resolves true only when the log actually persisted — the form clears on
   *  true and RETAINS the typed set on false (network drop, duplicate day), so
   *  an error toast never costs the user their input. */
  onAdd: (raw: string, date: string, note: string, bonus: boolean) => Promise<boolean>;
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
  const [bonus, setBonus] = useState(false);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    const saved = await onAdd(raw, date, note.trim(), bonus);
    if (!saved) return; // keep the typed set for a retry
    setWeightExpr("");
    setRepValues(emptyRepValues(n));
    setNote("");
    setBonus(false);
  }

  return (
    <form className="add-form log-redesign" ref={formRef} onSubmit={submit}>
      <LogTopbar date={date} setDate={setDate} bonus={bonus} setBonus={setBonus} />

      <WeightZone
        weightRef={weightRef}
        weightExpr={weightExpr}
        setWeightExpr={setWeightExpr}
        adjustWeight={adjustWeight}
        unit={unit}
        setUnit={setUnit}
        placeholder={lastParsed?.weightExpr ?? "0"}
      />

      <RepsZone
        setCount={n}
        values={repValues}
        onChange={setRepValues}
        onLastEnter={() => formRef.current?.requestSubmit()}
        defaultRep={defaultRep}
      />

      <NoteField value={note} onChange={setNote} />

      <LogFormFooter
        primaryLabel="Log set"
        submitting={submitting}
        disabled={!isValid || submitting}
        onCancel={onCancel}
      />
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
  /** Same contract as AddEntryForm.onAdd: true = persisted (clear the form),
   *  false = failed/bounced (retain the typed set). */
  onAdd: (raw: string, date: string, note: string, bonus: boolean) => Promise<boolean>;
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
  const [bonus, setBonus] = useState(false);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || effectiveLoad === null || submitting) return;
    localStorage.setItem(LAST_BW_KEY, String(parsedBw));
    const raw = normalize(`${parsedBw}-(${parsedAssist}) *${reps}`);
    const saved = await onAdd(raw, date, note.trim(), bonus);
    if (!saved) return; // keep the typed set for a retry
    setAssistance("");
    setRepValues(emptyRepValues(n));
    setNote("");
    setBonus(false);
  }

  return (
    <form className="add-form log-redesign" ref={formRef} onSubmit={submit}>
      <LogTopbar date={date} setDate={setDate} bonus={bonus} setBonus={setBonus} />

      <AssistedWeightZone
        assistRef={assistRef}
        assistance={assistance}
        setAssistance={setAssistance}
        adjustAssist={adjustAssist}
        bodyweight={bodyweight}
        setBodyweight={setBodyweight}
        bwFromHealth={bwFromHealth}
      />

      <RepsZone
        setCount={n}
        values={repValues}
        onChange={setRepValues}
        onLastEnter={() => formRef.current?.requestSubmit()}
      />

      <AssistedPreviewBar load={isValid ? effectiveLoad : null} reps={reps} assist={parsedAssist} />

      <NoteField value={note} onChange={setNote} />

      <LogFormFooter
        primaryLabel="Log set"
        submitting={submitting}
        disabled={!isValid || submitting}
        onCancel={onCancel}
      />
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
  submitting = false,
}: {
  log: TrainingLog;
  setCount: number;
  onSave: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  submitting?: boolean;
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
    if (!isValid || submitting) return;
    onSave(raw, log.log_date ?? "", note.trim());
  }

  return (
    <form className="add-form log-redesign log-edit" ref={formRef} onSubmit={save}>
      <WeightZone
        weightRef={weightRef}
        weightExpr={weightExpr}
        setWeightExpr={setWeightExpr}
        adjustWeight={adjustWeight}
        unit={unit}
        setUnit={setUnit}
      />

      <RepsZone
        setCount={n}
        values={repValues}
        onChange={setRepValues}
        onLastEnter={() => formRef.current?.requestSubmit()}
      />

      <NoteField value={note} onChange={setNote} />

      <LogFormFooter
        primaryLabel="Save changes"
        submitting={submitting}
        disabled={!isValid || submitting}
        onCancel={onCancel}
        onDelete={onDelete}
      />
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
  submitting = false,
}: {
  log: TrainingLog;
  setCount: number;
  onSave: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  submitting?: boolean;
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
    if (!isValid || submitting) return;
    const raw = normalize(`${parsedBw}-(${parsedAssist}) *${reps}`);
    onSave(raw, log.log_date ?? "", note.trim());
  }

  return (
    <form className="add-form log-redesign log-edit" ref={formRef} onSubmit={save}>
      <AssistedWeightZone
        assistRef={assistRef}
        assistance={assistance}
        setAssistance={setAssistance}
        adjustAssist={adjustAssist}
        bodyweight={bodyweight}
        setBodyweight={setBodyweight}
      />

      <RepsZone
        setCount={n}
        values={repValues}
        onChange={setRepValues}
        onLastEnter={() => formRef.current?.requestSubmit()}
      />

      <AssistedPreviewBar load={isValid ? effectiveLoad : null} reps={reps} assist={parsedAssist} />

      <NoteField value={note} onChange={setNote} />

      <LogFormFooter
        primaryLabel="Save changes"
        submitting={submitting}
        disabled={!isValid || submitting}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </form>
  );
}
