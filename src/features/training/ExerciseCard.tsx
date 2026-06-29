import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
} from "react";
import {
  addLog,
  deleteLog,
  updateLog,
  updateExercise,
  type Exercise,
  type TrainingLog,
} from "./api";
import { supabase } from "@shared/lib/supabase";
import {
  parse,
  score,
  formatRepsDisplay,
  normalize,
} from "./parser";
import {
  computeStats,
  computeHistDelta,
  filterByTime,
  timelineDate,
  type TimeFilter,
} from "./logic";
import { ToastProvider as _ToastProvider, useToast as _useToast } from "@shared/components/Toast";
export const ToastProvider = _ToastProvider;
export const useToast = _useToast;

// ─────────────────────────────────────────────────────────────────────────────
// Confirm dialog
// ─────────────────────────────────────────────────────────────────────────────

interface ConfirmOptions {
  confirmLabel?: string;
  danger?: boolean;
}

interface DialogState {
  msg: string;
  resolve: (ok: boolean) => void;
  confirmLabel: string;
  danger: boolean;
}

type ConfirmFn = (msg: string, opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback<ConfirmFn>((msg, opts = {}) => {
    return new Promise<boolean>((resolve) => {
      setDialog({
        msg,
        resolve,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        danger: opts.danger !== false,
      });
    });
  }, []);

  function handle(ok: boolean) {
    dialog?.resolve(ok);
    setDialog(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="confirm-overlay" onClick={() => handle(false)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="confirm-msg">{dialog.msg}</p>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => handle(false)}>
                Cancel
              </button>
              <button
                className={`btn-primary${dialog.danger ? " danger" : ""}`}
                onClick={() => handle(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MIN_SET_COUNT = 1;
const MAX_SET_COUNT = 5;
const DEFAULT_SET_COUNT = 3;
const LAST_BW_KEY = "liftos/lastBodyweight";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function heroInputStyle(value: string): React.CSSProperties | undefined {
  const len = String(value ?? "").trim().length;
  if (len <= 7) return undefined;
  return { fontSize: Math.min(46, Math.max(22, Math.round(400 / len))) + "px" };
}

function clampSetCount(n: number) {
  if (n >= MIN_SET_COUNT && n <= MAX_SET_COUNT) return n;
  return DEFAULT_SET_COUNT;
}

function targetSetCount(target: string | null | undefined): number {
  const m = String(target ?? "").match(/(?:×|x)\s*(\d+)\s*$/i);
  return m ? clampSetCount(parseInt(m[1], 10)) : 0;
}

function defaultSetCount(exercise: Exercise) {
  return targetSetCount(exercise.target) || DEFAULT_SET_COUNT;
}

function emptyRepValues(n: number) {
  return Array.from({ length: n }, () => "");
}

function repsStringToValues(reps: string, n: number): string[] {
  const count = Math.max(MIN_SET_COUNT, n);
  if (!reps) return emptyRepValues(count);
  const segs = String(reps).split(/[/\-]/);
  if (segs.length === 1) {
    return Array.from({ length: count }, () => segs[0]);
  }
  return Array.from({ length: count }, (_, i) => segs[i] ?? segs[segs.length - 1] ?? "");
}

function composeRepsMulti(values: string[], defaultRep: string): string {
  const resolved: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const t = (values[i] ?? "").trim();
    resolved.push(t || (i === 0 ? defaultRep : resolved[i - 1] ?? defaultRep));
  }
  const first = resolved[0];
  if (!first) return "";
  if (resolved.every((x) => x === first)) return resolved.join("/");
  return resolved.join("/");
}

function scrollIntoViewInterruptible(el: Element) {
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const stop = () => {
    const y = window.scrollY;
    const prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(window.scrollX, y);
    document.documentElement.style.scrollBehavior = prev;
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("keydown", stop);
  };
  window.addEventListener("wheel", stop, { passive: true, once: true });
  window.addEventListener("touchstart", stop, { passive: true, once: true });
  window.addEventListener("keydown", stop, { once: true });
  setTimeout(cleanup, 1000);
}

function useScrollAboveKeyboard(formRef: React.RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function adjust() {
      const form = formRef.current;
      if (!form) return;
      const btn = form.querySelector<HTMLElement>(".btn-log-primary");
      if (!btn) return;
      const btnBottom = btn.getBoundingClientRect().bottom;
      const viewBottom = vv!.offsetTop + vv!.height;
      if (btnBottom > viewBottom - 8) {
        window.scrollBy({ top: btnBottom - viewBottom + 16, behavior: "smooth" });
      }
    }
    vv.addEventListener("resize", adjust);
    const t = setTimeout(adjust, 120);
    return () => {
      vv.removeEventListener("resize", adjust);
      clearTimeout(t);
    };
  }, [formRef]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartImage
// ─────────────────────────────────────────────────────────────────────────────

function SmartImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  if (!src || !ok) return null;
  return (
    <img
      key={src}
      src={src}
      alt={alt ?? ""}
      className={className}
      loading="lazy"
      onError={() => setOk(false)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExprDisplay
// ─────────────────────────────────────────────────────────────────────────────

function fmtWeightNum(n: number): string {
  return parseFloat(n.toFixed(6)).toString();
}

function isLbUnit(unit: string | null | undefined) {
  return unit === "lbs" || unit === "lb";
}

function fmtKgFromLb(n: number): string {
  return (Math.round(n * 0.453592 * 100) / 100).toString();
}

interface ExprDisplayProps {
  raw: string | null;
  resultOnly?: boolean;
  detail?: boolean;
}

function ExprDisplay({ raw, resultOnly, detail }: ExprDisplayProps) {
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
    if (i === 0) return defaultRep ?? "";
    for (let j = i - 1; j >= 0; j--) {
      const p = (values[j] ?? "").trim();
      if (p) return p;
    }
    return defaultRep ?? "";
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
// AddEntryForm (normal)
// ─────────────────────────────────────────────────────────────────────────────

function AddEntryForm({
  setCount,
  lastRaw,
  onAdd,
  onCancel,
}: {
  setCount: number;
  lastRaw: string;
  onAdd: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
}) {
  const n = Math.max(MIN_SET_COUNT, setCount);
  const lastParsed = lastRaw ? parse(lastRaw) : null;
  const [weightExpr, setWeightExpr] = useState(lastParsed?.weightExpr ?? "");
  const defaultRep = lastParsed?.reps ? String(lastParsed.reps).split(/[/\-]/)[0] ?? "" : "";
  const [repValues, setRepValues] = useState(() => emptyRepValues(n));
  const [unit, setUnit] = useState<"kg" | "lbs">(isLbUnit(lastParsed?.unit) ? "lbs" : "kg");
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const weightRef = useRef<HTMLInputElement | null>(null);
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

  function adjustWeight(delta: number) {
    const base = preview?.weight ?? (parseFloat(weightExpr) || 0);
    const next = Math.max(0, base + delta);
    setWeightExpr(String(+next.toFixed(4)));
    weightRef.current?.focus();
  }

  function appendToken(tok: string) {
    setWeightExpr((s) => s + tok);
    weightRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
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
          {preview ? (
            <ExprDisplay raw={raw} detail />
          ) : (
            <span className="expr-bad">
              {!effectiveWeightExpr
                ? "enter weight"
                : !reps
                  ? "enter reps"
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

      <button type="submit" className="btn-log-primary" disabled={!preview}>
        Log set
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddAssistedForm
// ─────────────────────────────────────────────────────────────────────────────

function AddAssistedForm({
  setCount,
  lastLog,
  onAdd,
  onCancel,
}: {
  setCount: number;
  lastLog: TrainingLog | null;
  onAdd: (raw: string, date: string, note: string) => void;
  onCancel: () => void;
}) {
  const n = Math.max(MIN_SET_COUNT, setCount);
  const lastParsed = lastLog?.raw ? parse(lastLog.raw) : null;
  const lastAssist = lastParsed?.assisted?.assist ?? null;
  const savedBw = parseFloat(localStorage.getItem(LAST_BW_KEY) ?? "") || 0;
  const lastBw = lastParsed?.assisted?.bw ?? (savedBw || null);

  const [assistance, setAssistance] = useState(lastAssist != null ? String(lastAssist) : "");
  const [bodyweight, setBodyweight] = useState(lastBw ? String(lastBw) : "");
  const [repValues, setRepValues] = useState(() => emptyRepValues(n));
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const assistRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  useScrollAboveKeyboard(formRef);

  // Prefill from latest Health weight when no prior saved value exists
  useEffect(() => {
    if (lastBw) return;
    supabase
      .from("body_metrics")
      .select("weight_kg, metric_date")
      .not("weight_kg", "is", null)
      .order("metric_date", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.weight_kg && !bodyweight) setBodyweight(String(data.weight_kg));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsedAssist = parseFloat(assistance) || 0;
  const parsedBw = parseFloat(bodyweight) || 0;
  const effectiveLoad =
    parsedBw > 0 && parsedAssist > 0 ? +(parsedBw - parsedAssist).toFixed(2) : null;
  const reps = composeRepsMulti(repValues, "");
  const isValid = effectiveLoad !== null && effectiveLoad > 0 && reps.length > 0;

  function adjustAssist(delta: number) {
    const next = Math.max(0, parsedAssist + delta);
    setAssistance(String(+next.toFixed(2)));
    assistRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || effectiveLoad === null) return;
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

      <button type="submit" className="btn-log-primary" disabled={!isValid}>
        Log set
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InlineEditEntry (normal)
// ─────────────────────────────────────────────────────────────────────────────

function InlineEditEntry({
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
  const weightRef = useRef<HTMLInputElement | null>(null);

  const suffix = unit === "lbs" ? " lbs" : "";
  const reps = composeRepsMulti(repValues, "");
  const raw =
    weightExpr.trim() && reps
      ? normalize(`${weightExpr.trim()}${suffix} *${reps}`)
      : "";
  const preview = raw ? parse(raw) : null;

  function adjustWeight(delta: number) {
    const base = preview?.weight ?? (parseFloat(weightExpr) || 0);
    const next = Math.max(0, base + delta);
    setWeightExpr(String(+next.toFixed(4)));
    weightRef.current?.focus();
  }

  function appendToken(tok: string) {
    setWeightExpr((s) => s + tok);
    weightRef.current?.focus();
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
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
          {preview ? (
            <ExprDisplay raw={raw} detail />
          ) : (
            <span className="expr-bad">cannot parse</span>
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
        <button type="submit" className="btn-log-primary" disabled={!preview}>
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

function InlineEditAssistedEntry({
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
  const assistRef = useRef<HTMLInputElement | null>(null);
  useScrollAboveKeyboard(formRef);

  const parsedAssist = parseFloat(assistance) || 0;
  const parsedBw = parseFloat(bodyweight) || 0;
  const effectiveLoad =
    parsedBw > 0 && parsedAssist > 0 ? +(parsedBw - parsedAssist).toFixed(2) : null;
  const reps = composeRepsMulti(repValues, "");
  const isValid = effectiveLoad !== null && effectiveLoad > 0 && reps.length > 0;

  function adjustAssist(delta: number) {
    const next = Math.max(0, parsedAssist + delta);
    setAssistance(String(+next.toFixed(2)));
    assistRef.current?.focus();
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// ExerciseCard
// ─────────────────────────────────────────────────────────────────────────────

export interface ExerciseCardProps {
  exercise: Exercise;
  logs: TrainingLog[]; // newest-first (as returned by fetchLogsBySlug)
  timeFilter: TimeFilter;
  onLogged: () => void;
  onUpdate: (patch: Partial<Exercise>) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function ExerciseCard({
  exercise,
  logs,
  timeFilter,
  onLogged,
  onUpdate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ExerciseCardProps) {
  const toast = useToast();
  const confirm = useConfirm();

  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [justExpanded, setJustExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [prFlash, setPrFlash] = useState(false);
  const [newLogId, setNewLogId] = useState<string | null>(null);

  const [metaTarget, setMetaTarget] = useState(exercise.target ?? "");
  const [metaNote, setMetaNote] = useState(exercise.note ?? "");

  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMetaTarget(exercise.target ?? "");
    setMetaNote(exercise.note ?? "");
  }, [exercise.slug, exercise.target, exercise.note]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // logs come newest-first from Supabase; reverse for stats (asc)
  const logsAsc = useMemo(() => [...logs].reverse(), [logs]);
  const filteredAsc = useMemo(() => filterByTime(logsAsc, timeFilter), [logsAsc, timeFilter]);
  const stats = useMemo(() => computeStats(filteredAsc), [filteredAsc]);

  // For display: newest first
  const filteredDesc = useMemo(() => [...filteredAsc].reverse(), [filteredAsc]);
  const visibleCount = showAll ? filteredDesc.length : Math.min(3, filteredDesc.length);
  const visible = filteredDesc.slice(0, visibleCount);

  function commitMeta() {
    const t = metaTarget.trim();
    const n = metaNote.trim();
    if (
      t === (exercise.target ?? "").trim() &&
      n === (exercise.note ?? "").trim()
    )
      return;
    updateExercise(exercise.slug, { target: t || null, note: n || null })
      .then((ex) => onUpdate(ex))
      .catch(() => {});
  }

  async function handleAdd(raw: string, date: string, note: string) {
    const oldBestE1RM = stats.best?.e1rm ?? -1;
    try {
      const newLog = await addLog({
        slug: exercise.slug,
        raw,
        date,
        note: note || undefined,
      });
      setAdding(false);
      setNewLogId(newLog.id);
      setTimeout(() => setNewLogId(null), 1200);
      requestAnimationFrame(() => {
        if (cardRef.current) scrollIntoViewInterruptible(cardRef.current);
      });
      const newParsed = parse(raw);
      const newScore = newParsed ? score(newParsed) : 0;
      const repsNum = parseInt(newParsed?.reps?.split(/[/\-]/)[0] ?? "1", 10) || 1;
      const newE1RM = newScore > 0 ? newScore * (1 + repsNum / 30) : 0;
      if (newE1RM > oldBestE1RM) {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), 1100);
        const wStr = newParsed ? `${fmtWeightNum(score(newParsed))} kg` : "";
        toast(`🏆 New PR — ${wStr}`, "pr", 4000);
      } else {
        toast("Set logged", "success");
      }
      onLogged();
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function handleEdit(
    log: TrainingLog,
    raw: string,
    date: string,
    note: string,
  ) {
    try {
      const parsed = parse(raw);
      if (!parsed || !Number.isFinite(parsed.weight)) throw new Error("Cannot parse");
      await updateLog(log.id, {
        raw,
        reps: parsed.reps,
        weight_kg: Math.round(score(parsed) * 100) / 100,
        note: note || null,
        log_date: date,
        kind: parsed.assisted ? "assisted" : "normal",
        assistance: parsed.assisted?.assist ?? null,
        bodyweight: parsed.assisted?.bw ?? null,
      });
      setEditId(null);
      toast("Entry updated", "success");
      onLogged();
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function handleDelete(log: TrainingLog) {
    try {
      await deleteLog(log.id);
      setEditId(null);
      toast("Entry deleted", "info", 3000);
      onLogged();
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function archiveExercise() {
    const ok = await confirm(
      "Archive this exercise? History is kept — you can restore it anytime.",
      { confirmLabel: "Archive" },
    );
    if (!ok) return;
    try {
      const ex = await updateExercise(exercise.slug, { archived: true });
      onUpdate(ex);
      toast(`${exercise.name} archived`, "info");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  const sc = defaultSetCount(exercise);
  const best = stats.best;
  const bestParsed = best?.log.raw ? parse(best.log.raw) : null;
  const imgSrc = `${import.meta.env.BASE_URL}images/${exercise.split}/${exercise.slug}.png`;

  return (
    <article className="ex-card" ref={cardRef}>
      {/* ── Card menu ── */}
      <div className="ex-card-menu" ref={menuRef}>
        <button
          type="button"
          className={`card-menu-btn${menuOpen ? " menu-on" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Exercise options"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="card-menu-popup">
            <button
              type="button"
              className="card-menu-item"
              disabled={!!isFirst}
              onClick={() => {
                onMoveUp?.();
                setMenuOpen(false);
              }}
            >
              ↑ Move up
            </button>
            <button
              type="button"
              className="card-menu-item"
              disabled={!!isLast}
              onClick={() => {
                onMoveDown?.();
                setMenuOpen(false);
              }}
            >
              ↓ Move down
            </button>
            <button
              type="button"
              className="card-menu-item"
              onClick={() => {
                updateExercise(exercise.slug, { assisted_mode: !exercise.assisted_mode })
                  .then((ex) => onUpdate(ex))
                  .catch(() => {});
                setMenuOpen(false);
              }}
            >
              {exercise.assisted_mode ? "✓ Assisted mode" : "Assisted mode"}
            </button>
            <div className="card-menu-sep" />
            <button
              type="button"
              className="card-menu-item danger"
              onClick={() => {
                archiveExercise();
                setMenuOpen(false);
              }}
            >
              Archive…
            </button>
          </div>
        )}
      </div>

      {/* ── Title block ── */}
      <div className="ex-title-block">
        <div className="ex-title-row">
          {renaming ? (
            <input
              autoFocus
              className="rename-input"
              defaultValue={exercise.name}
              onBlur={(e) => {
                const name = e.target.value.trim() || exercise.name;
                updateExercise(exercise.slug, { name })
                  .then((ex) => onUpdate(ex))
                  .catch(() => {});
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <h3 className="ex-name" onClick={() => setRenaming(true)} title="Click to rename">
              {exercise.name}
            </h3>
          )}
          <input
            className="meta-input target-inline"
            value={metaTarget}
            onChange={(e) => setMetaTarget(e.target.value)}
            onBlur={commitMeta}
            placeholder="target"
            aria-label="Target / sets"
          />
        </div>
        <div className="ex-meta-row">
          <input
            className="meta-input note"
            value={metaNote}
            onChange={(e) => setMetaNote(e.target.value)}
            onBlur={commitMeta}
            placeholder="note"
            aria-label="Note"
            maxLength={80}
          />
        </div>
      </div>

      {/* ── Body: PR + image ── */}
      <div className="ex-body">
        <div className="ex-body-content">
          <div className={`ex-pr-inline${prFlash ? " pr-just-set" : ""}`}>
            {bestParsed && Number.isFinite(bestParsed.weight) ? (
              <div className="pr-top-row">
                <span className="pr-weight">
                  {bestParsed.assisted
                    ? `${fmtWeightNum(score(bestParsed))} kg`
                    : isLbUnit(bestParsed.unit)
                      ? `${fmtWeightNum(bestParsed.weight)} lb`
                      : `${fmtWeightNum(bestParsed.weight)} kg`}
                </span>
                <span className="pr-meta mono">×{formatRepsDisplay(bestParsed.reps)}</span>
                {bestParsed.assisted && (
                  <span className="pr-kg-hint">{bestParsed.assisted.assist} kg assist</span>
                )}
              </div>
            ) : (
              <span className="pr-empty">no PR yet</span>
            )}
          </div>
        </div>
        <div className="ex-ident-wrap">
          <SmartImage src={imgSrc} alt="" className="ex-ident" />
        </div>
      </div>

      {/* ── History ── */}
      <div className="ex-history">
        {filteredDesc.length === 0 ? (
          <div className="empty-row">no entries yet — log your first set ↓</div>
        ) : (
          visible.map((log, vi) => {
            // prIndex is index in filteredAsc; vi 0 = newest = last in asc
            const ascIdx = filteredAsc.length - 1 - vi;
            const isPR = ascIdx === stats.prIndex;
            const isEditing = editId === log.id;
            const isNew = newLogId === log.id;
            const revealing = justExpanded && vi >= 3;
            const td = timelineDate(log.log_date ?? "");
            const prevLog = visible[vi + 1] ?? null;
            const delta = isPR || !prevLog ? null : computeHistDelta(log, prevLog);
            const isAssisted = log.kind === "assisted";

            return (
              <div key={log.id}>
                <div
                  className={[
                    "hist-row",
                    isPR ? "is-pr" : "",
                    isEditing ? "is-editing" : "",
                    isNew ? "hist-row-new" : "",
                    revealing ? "hist-row-reveal" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    revealing ? { animationDelay: `${(vi - 3) * 32}ms` } : undefined
                  }
                >
                  <span className="hist-date" title={log.log_date ?? ""}>
                    <span className="hist-date-mon">{td.mon}</span>
                    <span className="hist-date-day mono">{td.day}</span>
                  </span>

                  <span className="hist-expr">
                    {isAssisted &&
                    log.bodyweight != null &&
                    log.assistance != null ? (
                      <span className="hist-assisted-wrap">
                        <span className="mono">
                          <strong>
                            {fmtWeightNum(log.bodyweight - log.assistance)}
                          </strong>
                          <span className="expr-sep">
                            {" "}
                            ×{formatRepsDisplay(log.reps ?? "")}
                          </span>
                        </span>
                        <span className="hist-assist-sub">
                          {log.assistance} kg assist
                        </span>
                      </span>
                    ) : (
                      <span className="hist-expr-row">
                        <ExprDisplay raw={log.raw} resultOnly />
                      </span>
                    )}
                    {log.note && (
                      <span className="hist-note">{log.note}</span>
                    )}
                  </span>

                  <span className="hist-change">
                    {isPR ? (
                      <span
                        className="hist-pill hist-pill-pr"
                        aria-label="Personal record"
                      >
                        PR
                      </span>
                    ) : delta ? (
                      <span className="hist-pill hist-pill-gain">{delta.text}</span>
                    ) : null}
                  </span>

                  <div className="hist-row-end">
                    <div className="hist-actions">
                      <button
                        type="button"
                        title="Edit entry"
                        onClick={() => {
                          setAdding(false);
                          setEditId(isEditing ? null : log.id);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                </div>

                {isEditing && (
                  <div className="ex-editor-drawer">
                    {isAssisted ? (
                      <InlineEditAssistedEntry
                        log={log}
                        setCount={sc}
                        onSave={(raw, date, note) =>
                          handleEdit(log, raw, date, note)
                        }
                        onCancel={() => setEditId(null)}
                        onDelete={() => handleDelete(log)}
                      />
                    ) : (
                      <InlineEditEntry
                        log={log}
                        setCount={sc}
                        onSave={(raw, date, note) =>
                          handleEdit(log, raw, date, note)
                        }
                        onCancel={() => setEditId(null)}
                        onDelete={() => handleDelete(log)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Show more ── */}
      {filteredDesc.length > 3 && !adding && (
        <button
          className="show-more"
          onClick={() => {
            const next = !showAll;
            setShowAll(next);
            if (next) {
              setJustExpanded(true);
              setTimeout(() => setJustExpanded(false), 700);
            }
          }}
        >
          {showAll
            ? "Show recent only"
            : `View all ${filteredDesc.length} entries`}
        </button>
      )}

      {/* ── Log set form or button ── */}
      {adding ? (
        exercise.assisted_mode ? (
          <AddAssistedForm
            setCount={sc}
            lastLog={logs[0] ?? null}
            onAdd={handleAdd}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <AddEntryForm
            setCount={sc}
            lastRaw={logs.find((l) => l.kind !== "assisted")?.raw ?? ""}
            onAdd={handleAdd}
            onCancel={() => setAdding(false)}
          />
        )
      ) : editId == null ? (
        <button
          type="button"
          className="hist-add"
          onClick={() => {
            setEditId(null);
            setAdding(true);
          }}
        >
          <span className="hist-add-plus">＋</span>
          <span className="hist-add-text">Log set</span>
        </button>
      ) : null}
    </article>
  );
}
