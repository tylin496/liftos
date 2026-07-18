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
  repeatSession,
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
import { computeStats, computeWeeklyVolume, computeMuscleWeeklyVolume, computeWeeklyVolumeTrend, nextSessionSplit } from "./logic";
import { inferMuscleGroup, resolveMuscleBySlug } from "./muscleGroup";
import { StrengthHealthCard } from "./StrengthHealthCard";
import { WeeklyVolumeCard } from "./WeeklyVolumeCard";
import { computeStrengthSummary } from "@features/overview/api";
import { defaultSetCount, inferAssisted, normalizeTarget, useScrollAboveKeyboard } from "./logFormHelpers";
import { parse, score, formatRepsDisplay } from "./parser";
import { fmtWeightNum } from "./ExprDisplay";
import type { TimeFilter } from "./logic";
import { SegmentedControl } from "@shared/components/SegmentedControl";
import { PageTopBar } from "@shared/components/PageTopBar";
import { useIsReadOnly } from "@app/layout/SessionContext";
import { useNav } from "@app/layout/NavContext";
import { getActiveScroller } from "@app/layout/activeScroller";
import { scrollRevealClear } from "@app/layout/revealScroll";
import { useHorizontalSwipe } from "@shared/hooks/useHorizontalSwipe";
import { buildTrainingJson } from "@shared/lib/copyAllData";
import { daysSince } from "@shared/lib/freshness";
import { localDateStr } from "@shared/lib/date";
import { haptic } from "@shared/lib/haptics";
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
  const toast = useToast();
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
      const url = await uploadStretchImage(split, stretch.id, file);
      URL.revokeObjectURL(blob);
      setLocalImageUrl(null);
      onSave({ image_url: url });
    } catch {
      // Don't let the photo silently vanish — revoke the preview, drop it, and
      // tell the user the upload failed (matches the exercise-image path).
      URL.revokeObjectURL(blob);
      setLocalImageUrl(null);
      toast("Couldn’t upload photo", "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    // click, not mousedown: closing on mousedown unmounts the menu before the
    // trailing synthetic click fires on iOS Safari, so that click falls through
    // to whatever is now underneath the tap.
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", onDown);
    return () => document.removeEventListener("click", onDown);
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
  submitting = false,
}: {
  onAdd: (name: string, target: string, note: string, assisted: boolean, compound: boolean) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [compound, setCompound] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Opens at the bottom of the page with an auto-focused field — keep its
  // primary button above the keyboard, same as the log forms.
  useScrollAboveKeyboard(formRef);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    // Don't clear the fields here: on success the parent unmounts this form, on
    // error it stays open — resetting would wipe the user's input on failure.
    onAdd(name.trim(), normalizeTarget(target), note.trim(), inferAssisted(name), compound);
  }

  return (
    <div className="add-ex-form" ref={formRef}>
      <div className="add-ex-head">
        <span className="add-ex-title">New exercise</span>
        <button type="button" className="add-ex-close" onClick={onCancel} aria-label="Close">✕</button>
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
              checked={compound}
              onChange={(e) => setCompound(e.target.checked)}
            />
            Compound
          </label>
          <button
            type="submit"
            className="btn-log-primary"
            disabled={!name.trim() || submitting}
            style={{ flex: 1 }}
          >
            {submitting ? "Adding…" : "Add exercise"}
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
  // under the floating tabbar. Shared disclosure-scroll keeps it clear of the
  // bar as it unfolds (rAF so the list is mounted first).
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      if (next) requestAnimationFrame(() => scrollRevealClear(listRef.current));
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
          <div className="archived-list-inner">
          {exercises.map((ex) => {
            const exLogs = logs[ex.slug] ?? [];
            const logsAsc = [...exLogs].reverse();
            const stats = computeStats(logsAsc, defaultSetCount(ex), ex.compound ? "compound" : "isolation", !!ex.assisted_mode);
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
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner page (needs toast/confirm context)
// ─────────────────────────────────────────────────────────────────────────────

// Shared frozen empty list for cards with no logs yet — a stable reference so a
// `logs={logs[slug] ?? EMPTY_LOGS}` prop doesn't hand memoized ExerciseCards a
// fresh `[]` every render (which would defeat React.memo for empty cards).
const EMPTY_LOGS: TrainingLog[] = Object.freeze([]) as unknown as TrainingLog[];

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
  const [addingSubmitting, setAddingSubmitting] = useState(false);
  const [repeating, setRepeating] = useState(false);
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

  // Splits are switched via the SegmentedControl or a horizontal swipe over the
  // exercise list (see splitSwipeRef below) — both funnel through here.
  function changeSplit(id: SplitId) {
    prevSplitIdx.current = splitIds.indexOf(split);
    didSwitchRef.current = true;
    setSplit(id);
    sessionStorage.setItem("tr-split", id);
    getActiveScroller()?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const nav = useNav();
  // Listener target for the split swipe — the whole page, so the gesture works
  // no matter where over the list the finger lands. Stable across split changes
  // (unlike the keyed .tr-list below), which the listener effect depends on.
  const pageRootRef = useRef<HTMLDivElement>(null);
  // Transform target for the LIVE drag — narrower than the listener: only the
  // exercise-list wrapper visually pages, not the header/segmented control.
  // Also stable across split changes for the same reason.
  const splitListWrapRef = useRef<HTMLDivElement>(null);
  // True the instant a swipe resolves into a real navigation (split change or
  // tab hand-off) — read by onDragEnd to skip the animated snap-back, since the
  // resulting remount/tab-switch already supplies its own transition.
  const splitSwipeCommittedRef = useRef(false);

  // A horizontal swipe within a split pages to the next/previous split, exactly
  // like tapping the SegmentedControl. Swiping further at either end — past the
  // first or last split — continues on to the neighbouring app tab (Overview
  // before Push, Nutrition after the last split), so "keep swiping" reads as one
  // continuous gesture across both levels of paging.
  function handleSplitSwipe(dir: 1 | -1) {
    splitSwipeCommittedRef.current = true;
    const idx = splitIds.indexOf(split);
    if (dir === 1) {
      if (idx < splitIds.length - 1) changeSplit(splitIds[idx + 1]);
      else nav("nutrition");
    } else {
      if (idx > 0) changeSplit(splitIds[idx - 1]);
      else nav("overview");
    }
  }

  useHorizontalSwipe(pageRootRef, handleSplitSwipe, {
    // A text-heavy form covers the list while adding an exercise — a stray
    // horizontal drag while composing a name shouldn't page the split away.
    enabled: !addingExercise,
    pointer: true,
    // Whole list follows the finger 1:1 within a split; rubber-band at either
    // end signals "this is the edge" before a decisive swipe/flick hands off to
    // the neighbouring tab (handleSplitSwipe, always resolves to something at
    // the edges — there's no further "can't go" state to dead-end into).
    onDrag: (dx) => {
      const el = splitListWrapRef.current;
      if (!el) return;
      const idx = splitIds.indexOf(split);
      const atEdge = (dx < 0 && idx === splitIds.length - 1) || (dx > 0 && idx === 0);
      const offset = atEdge ? Math.sign(dx) * Math.min(72, Math.abs(dx) * 0.2) : dx;
      el.style.transition = "none";
      el.style.transform = `translateX(${offset}px)`;
    },
    onDragEnd: () => {
      const el = splitListWrapRef.current;
      if (!el) return;
      if (splitSwipeCommittedRef.current) {
        // Committed: either the list remounts and plays its own slide-enter
        // animation, or the tab is switching away — clear instantly so the drag
        // transform doesn't fight either.
        splitSwipeCommittedRef.current = false;
        el.style.transition = "none";
        el.style.transform = "";
      } else {
        el.style.transition = "transform var(--dur-exit) var(--ease-snap)";
        el.style.transform = "";
      }
    },
  });

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
      ?.scrollIntoView({ block: "center" });
  }, [jumpTarget]);

  // Clear the jump target once its card has consumed it (opened its Trend via
  // openTrendSignal). A PASSIVE effect, not layout — React flushes a
  // descendant's (ExerciseCard's) passive effects before this one, so the card
  // has already reacted before we reset. Without this, jumpTarget stays stuck
  // forever: switching splits remounts every ExerciseCard (key={split}), and the
  // once-jumped-to exercise would keep reading a stale non-null openTrendSignal
  // on every future mount, wrongly re-opening its Trend sheet (e.g. every time
  // you return to the split it lives in).
  useEffect(() => {
    if (!jumpTarget) return;
    setJumpTarget(null);
  }, [jumpTarget]);

  // Auto-advance the split once per mount, off the first successful load: land
  // on the split you're about to train (nextSessionSplit — last-logged split
  // when it was logged today, the next one in rotation otherwise) so logging
  // never needs a manual split pick. Once-per-mount means a manual pick during
  // the session always wins over later background refetches; every fresh entry
  // (cold start, ≥3min-idle replay, pull-to-refresh remount) re-lands
  // automatically. Runs in the same commit as the data swap, so the list's
  // first real mount already shows the auto split — no visible split flip.
  const autoSplitDoneRef = useRef(false);

  const reloadAll = useCallback(async () => {
    try {
      const [ex, lg] = await Promise.all([fetchExercises(), fetchLogsBySlug()]);
      const pending = pendingDeleteSlugsRef.current;
      setExercises(pending.size ? ex.filter((e) => !pending.has(e.slug)) : ex);
      setLogs(lg);
      if (!autoSplitDoneRef.current) {
        autoSplitDoneRef.current = true;
        const auto = nextSessionSplit(ex, lg, SPLITS.map((s) => s.id), localDateStr());
        if (auto) {
          setSplit(auto as SplitId);
          sessionStorage.setItem("tr-split", auto);
        }
      }
      // A successful reload clears any earlier transient failure — without
      // this, a stale error banner outlives the recovery.
      setError(null);
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
    const fail = (e: unknown) => active && setError(String((e as Error)?.message ?? e));
    // Load immediately — don't gate the fetch behind the seed check (two round
    // trips of pure overhead for any existing user). Seeding runs in parallel and
    // only triggers a second reload when it actually inserted the first-use catalog.
    reloadAll().catch(fail);
    ensureSeeded()
      .then((seeded) => {
        if (seeded && active) reloadAll();
      })
      .catch(fail);
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

  // Memoized so their array identity is stable across unrelated re-renders
  // (expanding a row, logging a set on one card) — this stability is what lets
  // the per-slug handler map below stay referentially stable, which in turn
  // lets the memoized ExerciseCards skip re-rendering.
  const activeExercises = useMemo(
    () => (exercises ?? []).filter((e) => e.split === split && !e.archived),
    [exercises, split],
  );
  const archivedExercises = useMemo(
    () => (exercises ?? []).filter((e) => e.split === split && e.archived),
    [exercises, split],
  );

  // "Trained, nothing new" — the latest log of every active exercise in this
  // split that has history but isn't already logged today. Repeating these is
  // what marks today's session as done (carry-forward covers the rest): one tap
  // for a maintained day instead of retyping unchanged sets. Empty once the
  // split is fully logged (or has no history yet) — the button hides then.
  const repeatable = useMemo(() => {
    const today = localDateStr();
    return activeExercises
      .map((ex) => (logs[ex.slug] ?? [])[0])
      .filter((l): l is TrainingLog => !!l && !!l.raw)
      .filter((l) => !(logs[l.exercise_slug] ?? []).some((x) => x.log_date === today));
  }, [activeExercises, logs]);

  async function handleRepeatSession() {
    if (repeating || !repeatable.length) return;
    setRepeating(true);
    try {
      const rows = await repeatSession(repeatable, localDateStr());
      rows.forEach(onLogAdded);
      haptic("success");
      toast(
        `Session logged — ${rows.length} ${rows.length === 1 ? "exercise" : "exercises"} maintained`,
        "success",
      );
    } catch (e) {
      haptic("error");
      toast(String((e as Error)?.message ?? e), "error");
    } finally {
      setRepeating(false);
    }
  }

  async function handleAddExercise(
    name: string,
    target: string,
    note: string,
    assisted: boolean,
    compound: boolean,
  ) {
    if (addingSubmitting) return;
    setAddingSubmitting(true);
    try {
      const userId = await currentUserId();
      await addExercise(userId, split, name, target, note, assisted, compound);
      setAddingExercise(false);
      await reloadAll();
      toast(`${name} added`, "success");
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    } finally {
      setAddingSubmitting(false);
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

  const queueReorder = useCallback(
    (task: () => Promise<void>): Promise<void> => {
      const run = reorderQueueRef.current.then(task, task);
      reorderQueueRef.current = run.catch(() => {});
      return run;
    },
    [],
  );

  const moveExercise = useCallback(
    async (slug: string, direction: -1 | 1) => {
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
    },
    [split, queueReorder, reloadAll],
  );

  // Stable so the per-slug handler map (and thus each memoized ExerciseCard's
  // onMoveUp/onMoveDown props) only changes when the active list reorders.
  const handleMoveUp = useCallback(
    async (slug: string) => {
      try {
        await moveExercise(slug, -1);
      } catch (err) {
        toast(String((err as Error)?.message ?? err), "error");
      }
    },
    [moveExercise, toast],
  );

  const handleMoveDown = useCallback(
    async (slug: string) => {
      try {
        await moveExercise(slug, 1);
      } catch (err) {
        toast(String((err as Error)?.message ?? err), "error");
      }
    },
    [moveExercise, toast],
  );

  // Per-slug handler bundle, rebuilt only when the active list changes (add /
  // remove / reorder / edit). Handing each card stable onUpdate/onMoveUp/
  // onMoveDown references — instead of fresh inline arrows every render — is what
  // makes React.memo on ExerciseCard effective. Move handlers are keyed on
  // position within the active list (disabled at the ends).
  const cardHandlers = useMemo(() => {
    const map = new Map<
      string,
      {
        onUpdate: (patch: Partial<Exercise>) => void;
        onMoveUp?: () => Promise<void>;
        onMoveDown?: () => Promise<void>;
      }
    >();
    activeExercises.forEach((ex, idx) => {
      map.set(ex.slug, {
        onUpdate: (patch) =>
          setExercises((prev) =>
            (prev ?? []).map((e) =>
              e.slug === ex.slug ? { ...e, ...patch } : e,
            ),
          ),
        onMoveUp: idx > 0 ? () => handleMoveUp(ex.slug) : undefined,
        onMoveDown:
          idx < activeExercises.length - 1
            ? () => handleMoveDown(ex.slug)
            : undefined,
      });
    });
    return map;
  }, [activeExercises, handleMoveUp, handleMoveDown]);

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
    const compoundSlugs = new Set((exercises ?? []).filter((e) => e.compound).map((e) => e.slug));
    const namesBySlug = Object.fromEntries((exercises ?? []).map((e) => [e.slug, e.name]));
    const activeLogs = Object.fromEntries(
      Object.entries(logs).filter(([slug]) => !archivedSlugs.has(slug)),
    );
    return { strength: computeStrengthSummary(activeLogs, compoundSlugs, namesBySlug) };
  }, [logs, exercises]);

  // Weekly volume — total kg lifted this calendar week, completing each trained
  // split's roster via carry-forward (log one Pull set → the whole Pull roster
  // still counts, at each lift's most recent numbers). Same in-memory logs.
  // The muscle view re-buckets the same session rows per muscle group
  // (override-aware resolution — see muscleGroup.ts), so the two views always
  // sum to the same week.
  // Override-aware muscle resolution, shared by the weekly-volume muscle view
  // and the Training Health card so a pinned muscle_group_override moves the
  // lift everywhere at once.
  const muscleBySlug = useMemo(() => resolveMuscleBySlug(exercises ?? []), [exercises]);
  // Muscle-row evidence: the Weekly Volume card lists each group's
  // contributing lifts by name, so "Back 9 sets/wk" is inspectable.
  const nameBySlug = useMemo(
    () => new Map((exercises ?? []).map((ex) => [ex.slug, ex.name])),
    [exercises],
  );

  const weeklyVolume = useMemo(() => {
    // Archived lifts stay on the roster with activeUntil = their final log:
    // history up to that date still counts (archiving never rewrites what was
    // lifted), but nothing carries them forward past it.
    const roster = (exercises ?? []).flatMap((e) => {
      const base = { slug: e.slug, split: e.split, setCount: defaultSetCount(e), assistedMode: !!e.assisted_mode };
      if (!e.archived) return [base];
      const lastLog = logs[e.slug]?.find((l) => l.log_date)?.log_date;
      return lastLog ? [{ ...base, activeUntil: lastLog }] : [];
    });
    const namesBySlug = Object.fromEntries((exercises ?? []).map((e) => [e.slug, e.name]));
    const today = localDateStr();
    return {
      stat: computeWeeklyVolume(logs, roster, today),
      muscle: computeMuscleWeeklyVolume(logs, roster, today, (ex) =>
        muscleBySlug.get(ex.slug) ??
        inferMuscleGroup(namesBySlug[ex.slug] ?? ex.slug, ex.slug, ex.split),
      ),
      trend: computeWeeklyVolumeTrend(logs, roster, today),
    };
  }, [logs, exercises, muscleBySlug]);

  // Every distinct log date on record, any exercise — feeds the session-count
  // milestone (every 100th training day) in ExerciseCard. A log can only ever
  // add one new date, so callers compare against this set as of before the add.
  const allLogDates = useMemo(() => {
    const dates = new Set<string>();
    for (const arr of Object.values(logs)) {
      for (const l of arr) if (l.log_date) dates.add(l.log_date);
    }
    return dates;
  }, [logs]);

  // The split of the single most recent log across all splits, not just the
  // one currently open — each slug's array is already newest-first, so only
  // its head needs checking. Feeds the segmented-control ✓ (which split was
  // trained last) and the header note (how long ago).
  const lastTrained = useMemo(() => {
    const splitBySlug = new Map((exercises ?? []).map((e) => [e.slug, e.split]));
    let latest: TrainingLog | null = null;
    for (const arr of Object.values(logs)) {
      const head = arr[0];
      if (head && (!latest || head.log_date > latest.log_date)) latest = head;
    }
    if (!latest) return undefined;
    const splitId = splitBySlug.get(latest.exercise_slug);
    if (!splitId) return undefined;
    return { splitId, daysAgo: daysSince(latest.log_date) };
  }, [logs, exercises]);

  // First-time default: with no remembered split, land on the one trained last
  // (the ✓-marked split) once logs load — where the user left off. Runs once;
  // a manual switch writes tr-split via changeSplit and locks this out, so the
  // session memory still wins from then on. setSplit (not changeSplit) keeps the
  // entrance cascade and leaves tr-split unset, so it stays a recomputed default.
  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultAppliedRef.current) return;
    if (sessionStorage.getItem("tr-split")) {
      defaultAppliedRef.current = true;
      return;
    }
    if (lastTrained?.splitId) {
      defaultAppliedRef.current = true;
      setSplit(lastTrained.splitId as SplitId);
    }
  }, [lastTrained]);

  // Memoised because PageTopBar's useCrossfade compares the note by reference —
  // a fresh element every render would restart its 90ms fade cycle perpetually.
  const lastLoggedNote = useMemo(
    () =>
      lastTrained && (
        <span className={`page-topbar-sync-note${lastTrained.daysAgo >= 2 ? " is-bad" : ""}`}>
          Trained{" "}
          {lastTrained.daysAgo <= 0
            ? "today"
            : lastTrained.daysAgo === 1
              ? "yesterday"
              : `${lastTrained.daysAgo}d ago`}
        </span>
      ),
    [lastTrained],
  );

  return (
    <div className="page tr-page" ref={pageRootRef}>
      <div className="shell-header">
        <PageTopBar
          eyebrow="TRAINING"
          title={SPLITS.find((s) => s.id === split)?.name ?? split}
          onCopy={copyTrainingData}
          note={lastLoggedNote}
        />
      </div>
      {/* ── Segment control ── */}
      <div className="tr-top-row">
        <SegmentedControl
          options={SPLITS.map((s) => ({
            id: s.id,
            label: s.name,
            count: (exercises ?? []).filter((e) => e.split === s.id && !e.archived).length,
            marked: s.id === lastTrained?.splitId,
          }))}
          value={split}
          onChange={(id) => changeSplit(id as SplitId)}
        />
      </div>

      {error && <ErrorState message={error} onRetry={reloadAll} />}

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
      {/* Stable wrapper (not keyed by split) — the swipe's live-drag transform
          target. The keyed .tr-list inside still remounts per split for its own
          slide-enter animation on commit. */}
      <div ref={splitListWrapRef} className="tr-split-swipe">
        <div
          key={split}
          className={`tr-list ${
            didSwitchRef.current
              ? `tr-slide-${splitIds.indexOf(split) > prevSplitIdx.current ? "left" : "right"}`
              : "tr-enter"
          }`}
        >
          {activeExercises.map((ex, idx) => {
            const h = cardHandlers.get(ex.slug)!;
            const cardLogs = logs[ex.slug] ?? EMPTY_LOGS;
            // Scope the shared expandedLogId down to this card: pass the id only
            // when it belongs to one of this card's rows, else null. So toggling
            // a row re-renders just the owning card(s) instead of all of them
            // (the card's internal `expandedLogId === log.id` check is
            // unaffected — a foreign id never matches any of its rows anyway).
            const cardExpandedId =
              expandedLogId != null && cardLogs.some((l) => l.id === expandedLogId)
                ? expandedLogId
                : null;
            return (
              <ExerciseCard
                key={ex.slug}
                exercise={ex}
                logs={cardLogs}
                timeFilter={timeFilter}
                expandedLogId={cardExpandedId}
                setExpandedLogId={setExpandedLogId}
                onLogged={reloadLogs}
                onLogAdded={onLogAdded}
                priorSessionDates={allLogDates}
                onUpdate={h.onUpdate}
                onMoveUp={h.onMoveUp}
                onMoveDown={h.onMoveDown}
                isFirst={idx === 0}
                isLast={idx === activeExercises.length - 1}
                openTrendSignal={jumpTarget?.slug === ex.slug ? jumpTarget.nonce : null}
              />
            );
          })}
          {exercises && activeExercises.length === 0 && (
            <div className="empty-row">No exercises in this split yet — add one below.</div>
          )}
          {/* One-tap maintained session: repeats every not-yet-logged-today
              exercise at its last numbers, so "I trained, nothing new" costs a
              tap. Hidden once the split is fully logged or has no history. */}
          {!readOnly && repeatable.length > 0 && (
            <button
              type="button"
              className="tr-repeat-session"
              disabled={repeating}
              onClick={handleRepeatSession}
            >
              {repeating
                ? "Logging…"
                : `Repeat last session (${repeatable.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ── Stretches ── */}
      <StretchList
        split={split}
        stretches={stretches[split] ?? []}
        onChange={handleStretchChange}
      />

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
        muscleBySlug={muscleBySlug}
      />

      <WeeklyVolumeCard
        stat={exercises ? weeklyVolume.stat : undefined}
        muscle={exercises ? weeklyVolume.muscle : undefined}
        trend={exercises ? weeklyVolume.trend : undefined}
        nameBySlug={nameBySlug}
        loading={!exercises}
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
              submitting={addingSubmitting}
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingPage (with providers)
// ─────────────────────────────────────────────────────────────────────────────

export function TrainingPage() {
  return <TrainingPageInner />;
}
