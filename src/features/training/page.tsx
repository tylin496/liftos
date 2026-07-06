import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
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
  slugify,
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
import { StrengthHealthCard } from "./StrengthHealthCard";
import { computeStrengthSummary } from "@features/overview/api";
import { defaultSetCount, useScrollAboveKeyboard } from "./logFormHelpers";
import { parse, score, formatRepsDisplay } from "./parser";
import { fmtWeightNum } from "./ExprDisplay";
import type { TimeFilter } from "./logic";
import { SegmentedControl } from "@shared/components/SegmentedControl";
import { PageTopBar } from "@shared/components/PageTopBar";
import { useIsReadOnly } from "@app/layout/SessionContext";
import { getActiveScroller } from "@app/layout/activeScroller";
import { buildTrainingJson } from "@shared/lib/copyAllData";
import { EditIcon } from "./EditIcon";
import "./training.css";

const copyTrainingData = () => buildTrainingJson();

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
  const readOnly = useIsReadOnly();
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
          {!readOnly && (
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
                  <EditIcon className="menu-icon" />
                  <span>Edit</span>
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
          )}
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
  const readOnly = useIsReadOnly();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const addFormRef = useRef<HTMLDivElement>(null);

  // Same keyboard-aware scroll as the other add/edit forms.
  useScrollAboveKeyboard(addFormRef);

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
        {!readOnly && (
          <button type="button" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {!readOnly && adding && (
        <div className="add-ex-form" ref={addFormRef} style={{ padding: "var(--space-3)" }}>
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
  const formRef = useRef<HTMLDivElement>(null);

  // Opens at the bottom of the page with an auto-focused field — keep its
  // primary button above the keyboard, same as the log forms.
  useScrollAboveKeyboard(formRef);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Don't clear the fields here: on success the parent unmounts this form, on
    // error it stays open — resetting would wipe the user's input on failure.
    onAdd(name.trim(), target.trim(), note.trim(), assisted);
  }

  return (
    <div className="add-ex-form" ref={formRef}>
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
  const listRef = useRef<HTMLDivElement>(null);
  if (!exercises.length) return null;

  // Archived sits at the bottom of the page, so expanding it grows the list
  // under the floating tabbar. Nudge it into view once rendered.
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      if (next) {
        requestAnimationFrame(() =>
          listRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
        );
      }
      return next;
    });

  return (
    <div className="archived-section">
      <button
        type="button"
        className="archived-toggle"
        onClick={toggle}
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
        <div className="archived-list" ref={listRef}>
          {exercises.map((ex) => {
            const exLogs = logs[ex.slug] ?? [];
            const logsAsc = [...exLogs].reverse();
            const stats = computeStats(logsAsc, defaultSetCount(ex));
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
  const readOnly = useIsReadOnly();

  const [split, setSplit] = useState<SplitId>(() => {
    const saved = sessionStorage.getItem("tr-split");
    return (saved && SPLITS.some((s) => s.id === saved) ? saved : "push") as SplitId;
  });
  const prevSplitIdx = useRef(0);
  // First list mount is the tab entrance (cards cascade in); once the user taps a
  // different split, every later mount is a pager slide instead. Resets on page
  // remount (tab switch), so the cascade replays each time the tab is entered.
  const didSwitchRef = useRef(false);
  const splitIds = useMemo(() => SPLITS.map((s) => s.id), []);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [logs, setLogs] = useState<Record<string, TrainingLog[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("3mo");
  // Filter control stays tucked away until asked for — it only matters once
  // you're digging into full history, not while logging sets.
  const [timeFilterOpen, setTimeFilterOpen] = useState(false);
  const [addingExercise, setAddingExercise] = useState(false);
  const [stretches, setStretches] = useState<Record<SplitId, StretchItem[]>>(loadStretches);
  // The single history row whose est-1RM / %-of-PR detail is open. Lifted here
  // (not per-card) so opening one row's detail closes any other across all
  // cards — only one is ever expanded at a time. Log ids are globally unique,
  // so a single id targets exactly the right card.
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  // A Training Health row tap: jump to that lift's card and open its Trend. The
  // nonce makes each tap distinct so re-tapping the same lift re-fires.
  const [jumpTarget, setJumpTarget] = useState<{ slug: string; nonce: number } | null>(null);
  // Slugs currently in an optimistic-delete undo window — a background reloadAll
  // must not resurrect them, since the server row hasn't committed the delete yet.
  const pendingDeleteSlugsRef = useRef<Set<string>>(new Set());
  // Undo-window timers for archived deletes, keyed by slug, so an unmount
  // (leaving the tab inside the 5s window) can flush the pending deletes rather
  // than fire a stray setTimeout against an unmounted component.
  const archivedDeleteTimersRef = useRef<
    Map<string, { undone: boolean; timer: ReturnType<typeof setTimeout> }>
  >(new Map());

  // Splits are switched via the SegmentedControl only. Horizontal swipe here is
  // intentionally left to bubble to Shell's tab-swipe, so the gesture means the
  // same thing everywhere (switch tab). Nutrition keeps its own day/week swipe
  // because those have no equivalent control.
  function changeSplit(id: SplitId) {
    prevSplitIdx.current = splitIds.indexOf(split);
    didSwitchRef.current = true;
    setSplit(id);
    sessionStorage.setItem("tr-split", id);
    getActiveScroller()?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Training Health row → jump to that lift's card and open its Trend. Switch to
  // the lift's split first if it lives in another one, then bump jumpTarget: the
  // effect below scrolls to the card, and the card opens its own Trend from the
  // matching openTrendSignal.
  function jumpToExercise(slug: string) {
    const ex = (exercises ?? []).find((e) => e.slug === slug);
    if (!ex) return;
    const nextSplit = SPLITS.find((s) => s.id === ex.split)?.id;
    if (nextSplit && nextSplit !== split) {
      prevSplitIdx.current = splitIds.indexOf(split);
      didSwitchRef.current = true;
      setSplit(nextSplit);
      sessionStorage.setItem("tr-split", nextSplit);
    }
    setJumpTarget((prev) => ({ slug, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  // Position the panel on the card SYNCHRONOUSLY, before paint. A cross-split
  // jump remounts the list (key={split}) while the panel is still scrolled to
  // the Training Health card at the bottom — an rAF (post-paint) scroll would
  // paint one frame of the new split at that stale offset first, then jump (the
  // "judder"). A layout effect + instant scroll lands the card in the same frame
  // the split switches; the Trend sheet then opens over it. The list runs in the
  // commit before this, so the target card is already in the DOM.
  useLayoutEffect(() => {
    if (!jumpTarget) return;
    document
      .getElementById(`ex-card-${jumpTarget.slug}`)
      ?.scrollIntoView({ block: "start" });
  }, [jumpTarget]);

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
    setLogs((prev) => {
      const existing = prev[log.exercise_slug] ?? [];
      // Keep the slug's list newest-first by log_date so a back-dated set lands
      // in its true chronological slot instead of being pinned to the top —
      // otherwise it skews the vs-last delta / PR / trend until the next refetch.
      const at = existing.findIndex(
        (l) => (l.log_date ?? "") <= (log.log_date ?? ""),
      );
      const next =
        at === -1
          ? [...existing, log]
          : [...existing.slice(0, at), log, ...existing.slice(at)];
      return { ...prev, [log.exercise_slug]: next };
    });
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

  // On unmount (leaving the tab), flush any archived-deletes still inside their
  // undo window: commit the delete now instead of letting a stray timer fire.
  useEffect(() => {
    const timers = archivedDeleteTimersRef.current;
    return () => {
      for (const [slug, rec] of timers) {
        clearTimeout(rec.timer);
        if (!rec.undone) {
          currentUserId()
            .then((userId) => deleteExerciseAndLogs(userId, slug))
            .catch(() => {});
        }
      }
      timers.clear();
    };
  }, []);

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
    const record = {
      undone: false,
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    };
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
    record.timer = setTimeout(async () => {
      if (record.undone) return;
      archivedDeleteTimersRef.current.delete(slug);
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
    archivedDeleteTimersRef.current.set(slug, record);
    toast(`${ex?.name ?? "Exercise"} deleted`, "info", UNDO_MS, {
      label: "Undo",
      onClick: () => {
        record.undone = true;
        pendingDeleteSlugsRef.current.delete(slug);
        archivedDeleteTimersRef.current.delete(slug);
        clearTimeout(record.timer);
        restore();
      },
    });
  }

  function handleStretchChange(items: StretchItem[]) {
    setStretches((prev) => ({ ...prev, [split]: items }));
  }

  // Training Health, computed from the logs already in memory (no extra fetch) —
  // same pure functions Overview uses, so the two surfaces can't disagree. The
  // compound hero needs the first Pull-split lift and the first "row" lift,
  // resolved here from the exercise list (Overview resolves them via query).
  const strengthHealth = useMemo(() => {
    const archivedSlugs = new Set((exercises ?? []).filter((e) => e.archived).map((e) => e.slug));
    const activeLogs = Object.fromEntries(
      Object.entries(logs).filter(([slug]) => !archivedSlugs.has(slug)),
    );
    return { strength: computeStrengthSummary(activeLogs) };
  }, [logs, exercises]);

  return (
    <div className="page tr-page">
      <div className="shell-header">
        <PageTopBar
          eyebrow="TRAINING"
          title={SPLITS.find((s) => s.id === split)?.name ?? split}
          onCopy={copyTrainingData}
        />
      </div>
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
        className={`tr-list ${
          didSwitchRef.current
            ? `tr-slide-${splitIds.indexOf(split) > prevSplitIdx.current ? "left" : "right"}`
            : "tr-enter"
        }`}
      >
        {activeExercises.map((ex, idx) => (
          <ExerciseCard
            key={ex.slug}
            exercise={ex}
            logs={logs[ex.slug] ?? []}
            timeFilter={timeFilter}
            expandedLogId={expandedLogId}
            setExpandedLogId={setExpandedLogId}
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
            openTrendSignal={jumpTarget?.slug === ex.slug ? jumpTarget.nonce : null}
          />
        ))}
      </div>

      {/* ── Stretches ── */}
      <StretchList
        split={split}
        stretches={stretches[split] ?? []}
        onChange={handleStretchChange}
      />

      {/* ── Archived (owner only) ── */}
      {!readOnly && (
        <ArchivedSection
          exercises={archivedExercises}
          logs={logs}
          onRestore={handleRestore}
          onDelete={handleDeleteArchived}
        />
      )}

      {/* ── Add exercise (owner only) ── */}
      {!readOnly && (
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
      )}

      {/* ── Time filter ── */}
      {/* Tucked behind a disclosure, not shown by default — it only matters once
          you're looking at full history, not while just logging sets. */}
      {timeFilterOpen ? (
        <SegmentedControl
          options={[
            { id: "3mo", label: "3M" },
            { id: "year", label: "1Y" },
            { id: "all", label: "All" },
          ]}
          value={timeFilter}
          onChange={(id) => setTimeFilter(id as TimeFilter)}
        />
      ) : (
        <button
          type="button"
          className="tr-time-filter-toggle"
          onClick={() => setTimeFilterOpen(true)}
        >
          Filter history…
        </button>
      )}

      {/* ── Training Health (full card) ── */}
      {/* A stable card, so it renders in place: its own skeleton while logs load,
          then resolves the same DOM to real values (no separate skeleton to
          unmount). The exercise list above stays a separate skeleton — a dynamic
          list can't resolve N different cards from 3 placeholders in place. */}
      <StrengthHealthCard
        id="training-strength-health-card"
        variant="full"
        loading={!exercises}
        strength={exercises ? strengthHealth.strength : undefined}
        onJumpToExercise={jumpToExercise}
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
