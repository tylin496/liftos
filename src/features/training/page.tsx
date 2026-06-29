import { useCallback, useEffect, useRef, useState } from "react";
import { useCopyButton } from "@shared/hooks/useCopyButton";
import { supabase } from "@shared/lib/supabase";
import {
  ensureSeeded,
  fetchExercises,
  fetchLogsBySlug,
  addExercise,
  updateExercise,
  reorderExercises,
  deleteExerciseAndLogs,
  loadStretches,
  saveStretches,
  type Exercise,
  type TrainingLog,
  type StretchItem,
} from "./api";
import { SPLITS, type SplitId } from "./seed";
import {
  ExerciseCard,
  ToastProvider,
  ConfirmProvider,
  useToast,
  useConfirm,
} from "./ExerciseCard";
import { computeStats } from "./logic";
import { parse, score, formatRepsDisplay } from "./parser";
import type { TimeFilter } from "./logic";
import "./training.css";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function fmtWeightNum(n: number): string {
  return parseFloat(n.toFixed(6)).toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartStretchImage
// ─────────────────────────────────────────────────────────────────────────────

function SmartStretchImage({ split, stretchId }: { split: SplitId; stretchId: string }) {
  const [ok, setOk] = useState(true);
  const src = `/images/${split}/stretches/${stretchId}.png`;
  useEffect(() => setOk(true), [src]);
  if (!ok) return null;
  return (
    <img
      src={src}
      alt=""
      className="stretch-card-img"
      loading="lazy"
      onError={() => setOk(false)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StretchCard
// ─────────────────────────────────────────────────────────────────────────────

function StretchCard({
  stretch,
  split,
  onSave,
  onRemove,
}: {
  stretch: StretchItem;
  split: SplitId;
  onSave: (patch: Partial<StretchItem>) => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stretch.name);
  const [note, setNote] = useState(stretch.note ?? "");
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  function save() {
    if (!name.trim()) return;
    onSave({ name: name.trim(), note: note.trim() || undefined });
    setEditing(false);
  }

  function cancel() {
    setName(stretch.name);
    setNote(stretch.note ?? "");
    setEditing(false);
    setMenuOpen(false);
  }

  const stretchSlug = slugify(stretch.name);

  return (
    <article className="stretch-card">
      <SmartStretchImage split={split} stretchId={stretchSlug} />
      {editing ? (
        <div className="stretch-edit-form">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Stretch name"
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
          />
          <div className="stretch-edit-actions">
            <button type="button" onClick={save}>Save</button>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="stretch-card-body">
            <div className="stretch-name">{stretch.name}</div>
            {stretch.note && <div className="stretch-note">{stretch.note}</div>}
          </div>
          <div className="stretch-menu" ref={menuRef}>
            <button
              type="button"
              className="stretch-menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Stretch options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="stretch-menu-popup">
                <button
                  type="button"
                  className="stretch-menu-item"
                  onClick={() => {
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="stretch-menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove();
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StretchList
// ─────────────────────────────────────────────────────────────────────────────

function StretchList({
  split,
  stretches,
  onChange,
}: {
  split: SplitId;
  stretches: StretchItem[];
  onChange: (items: StretchItem[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");

  function addStretch() {
    if (!newName.trim()) return;
    const item: StretchItem = {
      id: slugify(newName.trim()) + "-" + Date.now().toString(36),
      name: newName.trim(),
      note: newNote.trim() || undefined,
    };
    onChange([...stretches, item]);
    setNewName("");
    setNewNote("");
    setAdding(false);
  }

  function updateStretch(id: string, patch: Partial<StretchItem>) {
    onChange(stretches.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeStretch(id: string) {
    onChange(stretches.filter((s) => s.id !== id));
  }

  return (
    <div className="stretches">
      <div className="section-head">
        <h2>Mobility / Stretches</h2>
        <button type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div className="add-ex-form" style={{ padding: "var(--space-3)" }}>
          <input
            className="ex-input"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Stretch name"
            onKeyDown={(e) => {
              if (e.key === "Enter") addStretch();
              if (e.key === "Escape") setAdding(false);
            }}
            style={{ marginBottom: "var(--space-2)" }}
          />
          <input
            className="ex-input"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="note (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") addStretch();
            }}
            style={{ marginBottom: "var(--space-2)" }}
          />
          <button
            type="button"
            className="btn-log-primary"
            onClick={addStretch}
            disabled={!newName.trim()}
          >
            Add stretch
          </button>
        </div>
      )}

      {stretches.length > 0 && (
        <div className="stretch-grid">
          {stretches.map((s) => (
            <StretchCard
              key={s.id}
              stretch={s}
              split={split}
              onSave={(patch) => updateStretch(s.id, patch)}
              onRemove={() => removeStretch(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddExerciseForm
// ─────────────────────────────────────────────────────────────────────────────

function AddExerciseForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, target: string, note: string, assisted: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [assisted, setAssisted] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim(), target.trim(), note.trim(), assisted);
    setName("");
    setTarget("");
    setNote("");
    setAssisted(false);
  }

  return (
    <div className="add-ex-form">
      <div className="add-ex-head">
        <span className="add-ex-title">New exercise</span>
        <button type="button" className="add-ex-close" onClick={onCancel}>✕</button>
      </div>
      <form onSubmit={submit}>
        <div className="add-ex-fields">
          <div className="add-ex-field">
            <label className="add-ex-label">Name</label>
            <input
              className="ex-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bench Press"
              required
            />
          </div>
          <div className="add-ex-field">
            <label className="add-ex-label">Target</label>
            <input
              className="ex-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 6-8 × 3"
            />
          </div>
          <div className="add-ex-field">
            <label className="add-ex-label">Note</label>
            <input
              className="ex-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>
        <div className="add-ex-foot" style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <label className="add-ex-opt">
            <input
              type="checkbox"
              checked={assisted}
              onChange={(e) => setAssisted(e.target.checked)}
            />
            Assisted mode
          </label>
          <button
            type="submit"
            className="btn-log-primary"
            disabled={!name.trim()}
            style={{ flex: 1 }}
          >
            Add exercise
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ArchivedSection
// ─────────────────────────────────────────────────────────────────────────────

function ArchivedSection({
  exercises,
  logs,
  onRestore,
  onDelete,
}: {
  exercises: Exercise[];
  logs: Record<string, TrainingLog[]>;
  onRestore: (slug: string) => void;
  onDelete: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!exercises.length) return null;

  return (
    <div className="archived-section">
      <button
        type="button"
        className="archived-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="archived-label">Archived</span>
        <span className="archived-count mono">{exercises.length}</span>
        <span style={{ color: "var(--ink-4)", fontSize: "12px" }}>{open ? "▲" : "▾"}</span>
      </button>
      {open && (
        <div className="archived-list">
          {exercises.map((ex) => {
            const exLogs = logs[ex.slug] ?? [];
            const logsAsc = [...exLogs].reverse();
            const stats = computeStats(logsAsc);
            const best = stats.best;
            const bestParsed = best?.log.raw ? parse(best.log.raw) : null;
            const prStr = bestParsed
              ? `${fmtWeightNum(score(bestParsed))} kg × ${formatRepsDisplay(bestParsed.reps)}`
              : null;

            return (
              <div className="archived-row" key={ex.slug}>
                <div className="archived-row-head">
                  <span className="archived-name">{ex.name}</span>
                  {prStr && <span className="archived-pr mono">PR: {prStr}</span>}
                  <span className="archived-entries mono">{exLogs.length} entries</span>
                </div>
                <div className="archived-actions">
                  <button type="button" onClick={() => onRestore(ex.slug)}>
                    Restore
                  </button>
                  <button type="button" className="danger" onClick={() => onDelete(ex.slug)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner page (needs toast/confirm context)
// ─────────────────────────────────────────────────────────────────────────────

function TrainingPageInner() {
  const toast = useToast();
  const confirm = useConfirm();

  const [split, setSplit] = useState<SplitId>("push");
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [logs, setLogs] = useState<Record<string, TrainingLog[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("3mo");
  const [addingExercise, setAddingExercise] = useState(false);
  const [stretches, setStretches] = useState<Record<SplitId, StretchItem[]>>(loadStretches);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Swipe gesture to switch tabs
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) < 44 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    const splitIds = SPLITS.map((s) => s.id);
    const idx = splitIds.indexOf(split);
    if (dx < 0 && idx < splitIds.length - 1) setSplit(splitIds[idx + 1]);
    else if (dx > 0 && idx > 0) setSplit(splitIds[idx - 1]);
  }

  const reloadAll = useCallback(async () => {
    try {
      const [ex, lg] = await Promise.all([fetchExercises(), fetchLogsBySlug()]);
      setExercises(ex);
      setLogs(lg);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, []);

  const reloadLogs = useCallback(() => {
    fetchLogsBySlug()
      .then(setLogs)
      .catch((e) => setError(String((e as Error)?.message ?? e)));
  }, []);

  useEffect(() => {
    let active = true;
    ensureSeeded()
      .then(reloadAll)
      .catch((e) => active && setError(String((e as Error)?.message ?? e)));
    return () => {
      active = false;
    };
  }, [reloadAll]);

  // Persist stretches
  useEffect(() => {
    saveStretches(stretches);
  }, [stretches]);

  const activeExercises = (exercises ?? []).filter(
    (e) => e.split === split && !e.archived,
  );
  const archivedExercises = (exercises ?? []).filter(
    (e) => e.split === split && e.archived,
  );

  async function handleAddExercise(
    name: string,
    target: string,
    note: string,
    assisted: boolean,
  ) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      await addExercise(user.id, split, name, target, note, assisted);
      setAddingExercise(false);
      await reloadAll();
      toast(`${name} added`, "success");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function handleMoveUp(slug: string) {
    const list = activeExercises;
    const idx = list.findIndex((e) => e.slug === slug);
    if (idx <= 0) return;
    const slugs = list.map((e) => e.slug);
    [slugs[idx - 1], slugs[idx]] = [slugs[idx], slugs[idx - 1]];
    await reorderExercises(slugs);
    await reloadAll();
  }

  async function handleMoveDown(slug: string) {
    const list = activeExercises;
    const idx = list.findIndex((e) => e.slug === slug);
    if (idx < 0 || idx >= list.length - 1) return;
    const slugs = list.map((e) => e.slug);
    [slugs[idx], slugs[idx + 1]] = [slugs[idx + 1], slugs[idx]];
    await reorderExercises(slugs);
    await reloadAll();
  }

  async function handleRestore(slug: string) {
    try {
      await updateExercise(slug, { archived: false });
      await reloadAll();
      toast("Exercise restored", "success");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function handleDeleteArchived(slug: string) {
    const ex = exercises?.find((e) => e.slug === slug);
    const ok = await confirm(
      `Permanently delete "${ex?.name ?? slug}" and all its history? This cannot be undone.`,
      { confirmLabel: "Delete", danger: true },
    );
    if (!ok) return;
    try {
      await deleteExerciseAndLogs(slug);
      await reloadAll();
      toast("Exercise deleted", "info");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  function handleStretchChange(items: StretchItem[]) {
    setStretches((prev) => ({ ...prev, [split]: items }));
  }

  function buildCopyText() {
    const splitName = SPLITS.find((s) => s.id === split)?.name ?? split;
    const exerciseData = activeExercises.map((ex) => {
      const exLogs = [...(logs[ex.slug] ?? [])].reverse(); // asc
      const stats = computeStats(exLogs);
      const pr = stats.best?.log.raw ? parse(stats.best.log.raw) : null;
      return {
        name: ex.name,
        target: ex.target ?? null,
        note: ex.note ?? null,
        pr_e1rm_kg: pr ? +score(pr) : null,
        pr_raw: stats.best?.log.raw ?? null,
        logs: exLogs.map((l) => {
          const p = l.raw ? parse(l.raw) : null;
          return {
            date: l.log_date,
            raw: l.raw,
            weight_kg: p ? +score(p) : null,
            reps: p?.reps ?? null,
            assist_kg: p?.assisted ?? null,
            note: l.note ?? null,
          };
        }),
      };
    });
    const strList = (stretches[split] ?? []).map((s) => ({
      name: s.name,
      note: s.note ?? null,
    }));
    const prsCount = exerciseData.filter((e) => e.pr_e1rm_kg != null).length;
    return JSON.stringify({
      source: "LiftOS",
      type: "training_session",
      date: new Date().toISOString().slice(0, 10),
      split: splitName,
      summary: {
        exercises: exerciseData.length,
        with_pr_data: prsCount,
      },
      exercises: exerciseData,
      stretches: strList,
    }, null, 2);
  }

  useCopyButton(buildCopyText);

  return (
    <div
      className="page tr-page"
      ref={contentRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Top row: seg + copy ── */}
      <div className="tr-top-row">
        <div className="seg" role="tablist">
          {SPLITS.map((s) => {
            const count = (exercises ?? []).filter((e) => e.split === s.id && !e.archived).length;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={split === s.id}
                className={`seg-item${split === s.id ? " is-active" : ""}`}
                onClick={() => setSplit(s.id)}
              >
                {s.name}
                {count > 0 && <span className="seg-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <section className="page-card">
          <p className="auth-error">{error}</p>
        </section>
      )}

      {!exercises && !error && (
        <section className="page-card">
          <p className="page-note">Loading…</p>
        </section>
      )}

      {/* ── Exercise cards ── */}
      <div className="tr-list">
        {activeExercises.map((ex, idx) => (
          <ExerciseCard
            key={ex.slug}
            exercise={ex}
            logs={logs[ex.slug] ?? []}
            timeFilter={timeFilter}
            onLogged={reloadLogs}
            onUpdate={(patch) =>
              setExercises((prev) =>
                (prev ?? []).map((e) =>
                  e.slug === ex.slug ? { ...e, ...patch } : e,
                ),
              )
            }
            onMoveUp={idx > 0 ? () => handleMoveUp(ex.slug) : undefined}
            onMoveDown={
              idx < activeExercises.length - 1
                ? () => handleMoveDown(ex.slug)
                : undefined
            }
            isFirst={idx === 0}
            isLast={idx === activeExercises.length - 1}
          />
        ))}
      </div>

      {/* ── Add exercise ── */}
      <div className="add-exercise">
        {addingExercise ? (
          <AddExerciseForm
            onAdd={handleAddExercise}
            onCancel={() => setAddingExercise(false)}
          />
        ) : (
          <button
            type="button"
            className="add-exercise-btn"
            onClick={() => setAddingExercise(true)}
          >
            + Add exercise
          </button>
        )}
      </div>

      {/* ── Archived ── */}
      <ArchivedSection
        exercises={archivedExercises}
        logs={logs}
        onRestore={handleRestore}
        onDelete={handleDeleteArchived}
      />

      {/* ── Stretches ── */}
      <StretchList
        split={split}
        stretches={stretches[split] ?? []}
        onChange={handleStretchChange}
      />

      {/* ── Time filter ── */}
      <div className="filter-bar">
        {(["3mo", "year", "all"] as TimeFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-btn${timeFilter === f ? " on" : ""}`}
            onClick={() => setTimeFilter(f)}
          >
            {f === "3mo" ? "3M" : f === "year" ? "Year" : "All"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingPage (with providers)
// ─────────────────────────────────────────────────────────────────────────────

export function TrainingPage() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <TrainingPageInner />
      </ConfirmProvider>
    </ToastProvider>
  );
}
