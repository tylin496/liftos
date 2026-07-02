import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { ErrorState } from "@shared/components/ErrorState";
import { useTabActivity } from "@app/layout/TabActivityContext";
import {
  ensureSeeded,
  currentUserId,
  fetchExercises,
  fetchLogsBySlug,
  addExercise,
  updateExercise,
  reorderExercises,
  deleteExerciseAndLogs,
  loadStretches,
  saveStretches,
  uploadStretchImage,
  type Exercise,
  type TrainingLog,
  type StretchItem,
} from "./api";
import { SPLITS, type SplitId } from "./seed";
import {
  ExerciseCard,
  useToast,
} from "./ExerciseCard";
import { computeStats } from "./logic";
import { parse, score, formatRepsDisplay } from "./parser";
import type { TimeFilter } from "./logic";
import { SegmentedControl } from "@shared/components/SegmentedControl";
import { usePageHeader } from "@app/layout/PageHeaderContext";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import { buildTrainingJson } from "@shared/lib/copyAllData";
import "./training.css";

const copyTrainingData = () => buildTrainingJson();

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
  return n.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SmartStretchImage
// ─────────────────────────────────────────────────────────────────────────────

function SmartStretchImage({ split, stretchId, imageUrl }: { split: SplitId; stretchId: string; imageUrl?: string }) {
  const staticSrc = `${import.meta.env.BASE_URL}images/${split}/stretches/${stretchId}.png`;
  const [src, setSrc] = useState(imageUrl ?? staticSrc);
  useEffect(() => setSrc(imageUrl ?? staticSrc), [imageUrl, staticSrc]);
  return (
    <img
      src={src}
      alt=""
      className="stretch-card-img"
      loading="lazy"
      onError={() => { if (src !== staticSrc) setSrc(staticSrc); }}
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
  const [uploading, setUploading] = useState(false);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = URL.createObjectURL(file);
    setLocalImageUrl(blob);
    setUploading(true);
    try {
      const url = await uploadStretchImage(stretch.id, file);
      URL.revokeObjectURL(blob);
      setLocalImageUrl(null);
      onSave({ image_url: url });
    } catch {
      setLocalImageUrl(null);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

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
      <SmartStretchImage split={split} stretchId={stretchSlug} imageUrl={localImageUrl ?? stretch.image_url} />
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
              <div className="menu-popup stretch-menu-popup">
                <button
                  type="button"
                  className="menu-item stretch-menu-item"
                  onClick={() => {
                    setEditing(true);
                    setMenuOpen(false);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="menu-item stretch-menu-item"
                  disabled={uploading}
                  onClick={() => {
                    fileInputRef.current?.click();
                    setMenuOpen(false);
                  }}
                >
                  {uploading ? "Uploading…" : "Upload photo"}
                </button>
                <button
                  type="button"
                  className="menu-item stretch-menu-item danger"
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageUpload}
      />
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
        <svg
          className={`archived-chevron${open ? " open" : ""}`}
          width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
  const activity = useTabActivity();

  const [split, setSplit] = useState<SplitId>(() => {
    const saved = sessionStorage.getItem("tr-split");
    return (saved && SPLITS.some((s) => s.id === saved) ? saved : "push") as SplitId;
  });
  const prevSplitIdx = useRef(0);
  const splitIds = useMemo(() => SPLITS.map((s) => s.id), []);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [logs, setLogs] = useState<Record<string, TrainingLog[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("3mo");
  const [addingExercise, setAddingExercise] = useState(false);
  const [stretches, setStretches] = useState<Record<SplitId, StretchItem[]>>(loadStretches);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Slugs currently in an optimistic-delete undo window — a background reloadAll
  // must not resurrect them, since the server row hasn't committed the delete yet.
  const pendingDeleteSlugsRef = useRef<Set<string>>(new Set());

  // Horizontal swipe → switch split. The hook stops the gesture bubbling to
  // Shell's tab-swipe (this page owns it).
  useHorizontalSwipe(contentRef, (dir) => {
    const idx = splitIds.indexOf(split);
    if (dir === 1 && idx < splitIds.length - 1) changeSplit(splitIds[idx + 1]);
    else if (dir === -1 && idx > 0) changeSplit(splitIds[idx - 1]);
  }, { threshold: 44 });

  function changeSplit(id: SplitId) {
    prevSplitIdx.current = splitIds.indexOf(split);
    setSplit(id);
    sessionStorage.setItem("tr-split", id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const reloadAll = useCallback(async () => {
    try {
      const [ex, lg] = await Promise.all([fetchExercises(), fetchLogsBySlug()]);
      const pending = pendingDeleteSlugsRef.current;
      setExercises(pending.size ? ex.filter((e) => !pending.has(e.slug)) : ex);
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

  // Optimistic insert for a freshly-added set — avoids a full-table refetch
  // on the app's most frequent action. Edits/deletes still go through
  // reloadLogs since they touch existing rows.
  const onLogAdded = useCallback((log: TrainingLog) => {
    setLogs((prev) => ({
      ...prev,
      [log.exercise_slug]: [log, ...(prev[log.exercise_slug] ?? [])],
    }));
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

  // Background re-fetch when user navigates back to this tab
  useEffect(() => {
    if (activity === 0) return;
    reloadAll();
  }, [activity, reloadAll]);

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
      const userId = await currentUserId();
      await addExercise(userId, split, name, target, note, assisted);
      setAddingExercise(false);
      await reloadAll();
      toast(`${name} added`, "success");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  // Reorder moves are queued so two moves fired in quick succession (even on
  // different cards) run one at a time against the post-reload exercise list,
  // instead of racing each other from stale pre-move state.
  const reorderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const exercisesRef = useRef<Exercise[]>([]);
  useEffect(() => {
    exercisesRef.current = exercises ?? [];
  }, [exercises]);

  function queueReorder(task: () => Promise<void>): Promise<void> {
    const run = reorderQueueRef.current.then(task, task);
    reorderQueueRef.current = run.catch(() => {});
    return run;
  }

  async function moveExercise(slug: string, direction: -1 | 1) {
    const userId = await currentUserId();
    await queueReorder(async () => {
      const list = exercisesRef.current.filter(
        (e) => e.split === split && !e.archived,
      );
      const idx = list.findIndex((e) => e.slug === slug);
      const otherIdx = idx + direction;
      if (idx < 0 || otherIdx < 0 || otherIdx >= list.length) return;
      const slugs = list.map((e) => e.slug);
      [slugs[idx], slugs[otherIdx]] = [slugs[otherIdx], slugs[idx]];
      await reorderExercises(userId, slugs);
      await reloadAll();
    });
  }

  async function handleMoveUp(slug: string) {
    try {
      await moveExercise(slug, -1);
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  async function handleMoveDown(slug: string) {
    try {
      await moveExercise(slug, 1);
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
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

  function handleDeleteArchived(slug: string) {
    const idx = exercises?.findIndex((e) => e.slug === slug) ?? -1;
    const ex = idx >= 0 ? exercises![idx] : undefined;
    const UNDO_MS = 5000;
    let undone = false;
    // Restore the exercise at its original sort_order position.
    const restore = () =>
      setExercises((prev) => {
        if (!prev || !ex || prev.some((e) => e.slug === slug)) return prev;
        const next = [...prev];
        next.splice(Math.min(idx, next.length), 0, ex);
        return next;
      });
    pendingDeleteSlugsRef.current.add(slug);
    // Optimistically hide from list
    setExercises((prev) => prev?.filter((e) => e.slug !== slug) ?? prev);
    const commit = setTimeout(async () => {
      if (undone) return;
      try {
        const userId = await currentUserId();
        await deleteExerciseAndLogs(userId, slug);
        pendingDeleteSlugsRef.current.delete(slug);
        await reloadAll();
      } catch (err) {
        pendingDeleteSlugsRef.current.delete(slug);
        restore();
        toast(String((err as Error)?.message ?? err), "error");
      }
    }, UNDO_MS);
    toast(`${ex?.name ?? "Exercise"} deleted`, "info", UNDO_MS, {
      label: "Undo",
      onClick: () => {
        undone = true;
        pendingDeleteSlugsRef.current.delete(slug);
        clearTimeout(commit);
        restore();
      },
    });
  }

  function handleStretchChange(items: StretchItem[]) {
    setStretches((prev) => ({ ...prev, [split]: items }));
  }

  usePageHeader({
    eyebrow: "TRAINING",
    title: SPLITS.find((s) => s.id === split)?.name ?? split,
    onCopy: copyTrainingData,
  });

  return (
    <div
      className="page tr-page"
      ref={contentRef}
    >
      {/* ── Segment control ── */}
      <div className="tr-top-row">
        <SegmentedControl
          options={SPLITS.map((s) => ({
            id: s.id,
            label: s.name,
            count: (exercises ?? []).filter((e) => e.split === s.id && !e.archived).length,
          }))}
          value={split}
          onChange={(id) => changeSplit(id as SplitId)}
        />
      </div>

      {error && <ErrorState message={error} />}

      {!exercises && !error && (
        <>
          {[0, 1, 2].map((i) => (
            <article key={i} className="ex-card loading-card">
              <div className="ex-title-block">
                <div className="ex-title-row">
                  <h3 className="ex-name">Exercise Name</h3>
                </div>
                <div className="ex-meta-row" />
              </div>
              <div className="ex-body">
                <div className="ex-body-content">
                  <div className="ex-pr-inline">
                    <div className="pr-top-row">
                      <span className="pr-weight">00.0 kg</span>
                      <span className="pr-meta mono">×00</span>
                    </div>
                  </div>
                </div>
                <div className="ex-ident-wrap" />
              </div>
              <div className="ex-history">
                {[0, 1, 2].map((j) => (
                  <div key={j} className="hist-row">
                    <span className="hist-date">
                      <span className="hist-date-mon">JAN</span>
                      <span className="hist-date-day mono">00</span>
                    </span>
                    <span className="hist-expr">
                      <span className="hist-expr-row">00.0 kg × 00</span>
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </>
      )}

      {/* ── Exercise cards ── */}
      <div
        key={split}
        className={`tr-list tr-slide-${splitIds.indexOf(split) > prevSplitIdx.current ? "left" : "right"}`}
      >
        {activeExercises.map((ex, idx) => (
          <ExerciseCard
            key={ex.slug}
            exercise={ex}
            logs={logs[ex.slug] ?? []}
            timeFilter={timeFilter}
            onLogged={reloadLogs}
            onLogAdded={onLogAdded}
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

      {/* ── Stretches ── */}
      <StretchList
        split={split}
        stretches={stretches[split] ?? []}
        onChange={handleStretchChange}
      />

      {/* ── Archived ── */}
      <ArchivedSection
        exercises={archivedExercises}
        logs={logs}
        onRestore={handleRestore}
        onDelete={handleDeleteArchived}
      />

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

      {/* ── Time filter ── */}
      <SegmentedControl
        options={[
          { id: "3mo", label: "3M" },
          { id: "year", label: "1Y" },
          { id: "all", label: "All" },
        ]}
        value={timeFilter}
        onChange={(id) => setTimeFilter(id as TimeFilter)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingPage (with providers)
// ─────────────────────────────────────────────────────────────────────────────

export function TrainingPage() {
  return <TrainingPageInner />;
}
