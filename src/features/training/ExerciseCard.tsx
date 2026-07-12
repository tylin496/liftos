import { useEffect, useMemo, useRef, useState } from "react";
import {
  addLog,
  deleteLog,
  updateLog,
  updateExercise,
  uploadExerciseImage,
  type Exercise,
  type TrainingLog,
} from "./api";
import { parse, score, formatRepsDisplay } from "./parser";
import type { SplitId } from "./seed";
import {
  computeStats,
  computeHistDelta,
  filterByTime,
  toLogEntry,
  epley1RM,
  computePRBests,
  classifyPR,
  totalReps,
  maxReps,
  type TimeFilter,
  type ScoreMode,
} from "./logic";
import { timelineDate } from "@shared/lib/date";
import { milestoneReached } from "./milestone";
import { sessionMilestoneReached } from "./sessionMilestone";
import { useToast } from "@shared/components/Toast";
import { ExprDisplay, fmtWeightNum, isLbUnit } from "./ExprDisplay";
import { scrollRevealClear } from "@app/layout/revealScroll";
import { CLEAR_AFTER_SHEEN } from "@shared/lib/motion";
import { defaultSetCount } from "./logFormHelpers";
import { AddEntryForm, AddAssistedForm, InlineEditEntry, InlineEditAssistedEntry } from "./LogForms";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useCelebration } from "@shared/components/Celebration";
import { haptic } from "@shared/lib/haptics";
import { EditExerciseForm } from "./EditExerciseForm";
import { TrendSheet } from "./TrendSheet";
import { EditIcon, PenLineIcon, PlusIcon, ArrowUpIcon, ArrowDownIcon, ArchiveIcon } from "./EditIcon";
import { AnimatedNumber } from "@shared/components/AnimatedNumber";
import { useIsReadOnly } from "@app/layout/SessionContext";
import { getActiveScroller } from "@app/layout/activeScroller";

export { useToast };

/* PR weight number — counts up once on first load, staggered bottom-up by
   card. Blank until it rolls; off-screen cards get no stagger. Stays settled
   across tab switches — only a real value change tweens it again. */
function AnimatedWeight({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <>{fmtWeightNum(value)}</>;
  const decimals = fmtWeightNum(value).split(".")[1]?.length ?? 0;
  return <AnimatedNumber value={value} decimals={decimals} format={fmtWeightNum} />;
}


/* Tiny rising-bars glyph next to the exercise name — signals the title opens a
   trend chart without spending a full row on the affordance. */
function ChartGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden focusable="false">
      <path d="M1.5 11.5V7.5M5 11.5V4M8.5 11.5V6M12 11.5V2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

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

function scrollIntoViewInterruptible(el: Element) {
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // Freeze the smooth scroll on the panel it runs in (its nearest scroller).
  const scroller = getActiveScroller();
  const stop = () => {
    if (scroller) {
      const y = scroller.scrollTop;
      const prev = scroller.style.scrollBehavior;
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop = y;
      scroller.style.scrollBehavior = prev;
    }
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

export interface ExerciseCardProps {
  exercise: Exercise;
  logs: TrainingLog[]; // newest-first (as returned by fetchLogsBySlug)
  timeFilter: TimeFilter;
  // Lifted to the page so only one row's detail is open across all cards.
  expandedLogId: string | null;
  setExpandedLogId: (id: string | null | ((cur: string | null) => string | null)) => void;
  onLogged: () => void;
  onLogAdded: (log: TrainingLog) => void;
  // Every distinct log date on record account-wide (any exercise), as of
  // before this save — used to detect a session-count milestone (every 100th
  // training day). Not scoped to this exercise's own `logs`.
  priorSessionDates: ReadonlySet<string>;
  onUpdate: (patch: Partial<Exercise>) => void;
  onMoveUp?: () => Promise<void>;
  onMoveDown?: () => Promise<void>;
  isFirst?: boolean;
  isLast?: boolean;
  // A one-shot nonce (from a Training Health row tap) that opens this card's
  // Trend sheet on arrival. Each distinct value re-triggers; null does nothing.
  openTrendSignal?: number | null;
}

export function ExerciseCard({
  exercise,
  logs,
  timeFilter,
  expandedLogId,
  setExpandedLogId,
  onLogged,
  onLogAdded,
  priorSessionDates,
  onUpdate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  openTrendSignal,
}: ExerciseCardProps) {
  const toast = useToast();
  const celebration = useCelebration();
  const readOnly = useIsReadOnly();

  type EditingMode = "view" | "meta" | "logset" | "edithist";

  const [editingMode, setEditingMode] = useState<EditingMode>("view");
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [justExpanded, setJustExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [prFlash, setPrFlash] = useState(false);
  const [deletedLogIds, setDeletedLogIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [localImageUrl, setLocalImageUrl] = useState<string>();
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);
  // Open Trend when jumped here from a Training Health row (Shell scrolls the
  // card into view; this pops its sheet). One-shot per nonce so re-jumping the
  // same card re-opens it, but a manual close isn't undone by a re-render.
  useEffect(() => {
    if (openTrendSignal != null) setTrendOpen(true);
  }, [openTrendSignal]);

  const [submitting, setSubmitting] = useState(false);
  // Separate from `submitting` (the add path) so an in-flight inline edit
  // doesn't flip the always-mounted add form's button to "Saving…".
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Toggle a history row's detail drawer. On open, the entry row grows as the
  // drawer unfolds inside it; shared disclosure-scroll keeps the row's bottom
  // clear of the floating tabbar (rAF so the drawer is mounted and growing
  // first). Rows already fully visible are left untouched — no jump on mid-card
  // taps — since it only scrolls while the bottom is actually occluded.
  const toggleExpanded = (logId: string, entryEl: HTMLElement | null) =>
    setExpandedLogId((cur) => {
      const next = cur === logId ? null : logId;
      if (next && entryEl) requestAnimationFrame(() => scrollRevealClear(entryEl));
      return next;
    });

  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Undo-window timers for log deletes, keyed by log id, so an unmount (e.g.
  // switching splits inside the 5s window) can flush them instead of firing a
  // stray setTimeout against an unmounted card.
  const pendingLogDeletesRef = useRef<
    Map<string, { undone: boolean; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  // Latest onLogged, so the unmount-only flush effect below can refresh the
  // parent without re-subscribing (onLogged is stable, but this stays correct
  // even if it isn't).
  const onLoggedRef = useRef(onLogged);
  onLoggedRef.current = onLogged;


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

  // On unmount (e.g. switching splits inside the undo window), flush pending log
  // deletes: commit them immediately rather than leave stray timers behind.
  useEffect(() => {
    const timers = pendingLogDeletesRef.current;
    return () => {
      const flushing: Promise<unknown>[] = [];
      for (const [id, rec] of timers) {
        clearTimeout(rec.timer);
        if (!rec.undone) flushing.push(deleteLog(id).catch(() => {}));
      }
      timers.clear();
      // Refresh the (still-mounted) parent once the deletes commit, so the row
      // doesn't reappear if the user returns to this split before a reload.
      if (flushing.length) Promise.all(flushing).then(() => onLoggedRef.current());
    };
  }, []);

  // Keep the menu mounted through its exit animation.
  const menuT = useExitTransition(menuOpen, 120);

  // Keep the inline-edit drawer mounted through its collapse so closing it
  // (save/cancel/delete) doesn't instantly snap the layout below it upward —
  // that abrupt collapse read as the view jumping to the next exercise card.
  // Only one row can be editing at a time, so a single hook call at the card
  // level (rather than one per mapped row, which would break the rules of
  // hooks) is enough; closingLogId remembers which row to keep rendering
  // while it plays the exit animation.
  const editorT = useExitTransition(editingLogId != null, 200);
  const closingLogIdRef = useRef<string | null>(null);
  if (editingLogId != null) closingLogIdRef.current = editingLogId;

  // logs come newest-first from Supabase; reverse for stats (asc)
  // Exclude optimistically-deleted entries from display
  const effectiveLogs = useMemo(
    () => (deletedLogIds.size ? logs.filter((l) => !deletedLogIds.has(l.id)) : logs),
    [logs, deletedLogIds],
  );
  const effectiveLogsAsc = useMemo(() => [...effectiveLogs].reverse(), [effectiveLogs]);
  const filteredAsc = useMemo(
    () => filterByTime(effectiveLogsAsc, timeFilter),
    [effectiveLogsAsc, timeFilter],
  );
  const sc = defaultSetCount(exercise);
  // Score mode: compound lifts judge on e1RM, isolation on best-set tonnage — the
  // one switch every strength read (PR badge, confetti, history delta) flows from.
  const mode: ScoreMode = exercise.compound ? "compound" : "isolation";
  // Stats use ALL logs (unfiltered, undeleted) so the PR badge/confetti reflect
  // the all-time record, not just what's inside the current time-filter window.
  const stats = useMemo(() => computeStats(effectiveLogsAsc, sc, mode), [effectiveLogsAsc, sc, mode]);
  // Index of the all-time-best log within the currently displayed (filtered) window,
  // so the history list can still highlight it when it's visible.
  const prIndexInFiltered = useMemo(
    () => (stats.best ? filteredAsc.indexOf(stats.best.log) : -1),
    [filteredAsc, stats.best],
  );

  // For display: newest first
  const filteredDesc = useMemo(() => [...filteredAsc].reverse(), [filteredAsc]);
  const visibleCount = showAll ? filteredDesc.length : Math.min(2, filteredDesc.length);
  const visible = filteredDesc.slice(0, visibleCount);

  // Which log form to show: follow the most recent entry's kind, but for an
  // exercise with no logs yet honour its declared assisted_mode — otherwise the
  // "Assisted mode" flag set at creation (incl. the seeded Assisted Pull-up)
  // would never surface the assisted form until a first entry somehow exists.
  const addAssisted = effectiveLogs.length
    ? effectiveLogs[0]?.kind === "assisted"
    : !!exercise.assisted_mode;


  async function handleAdd(raw: string, date: string, note: string) {
    if (submitting) return;
    // One entry per exercise per day — every set for the day lives in a single
    // drop-set entry, so a second same-day log is always a mistake. Point the
    // user at the existing entry instead of silently creating a duplicate.
    if (effectiveLogs.some((l) => l.log_date === date)) {
      haptic("error");
      toast("Already logged for that day — edit that entry instead", "error");
      return;
    }
    setSubmitting(true);
    const oldBest = stats.best;
    try {
      const newLog = await addLog({
        slug: exercise.slug,
        raw,
        date,
        note: note || undefined,
      });
      setEditingMode("view");
      // A logged set IS a completed set — confirm it with the shared "set
      // complete" flash (accent check + row wash), same as an edit save.
      setSavedRowId(newLog.id);
      setTimeout(() => setSavedRowId(null), CLEAR_AFTER_SHEEN);
      requestAnimationFrame(() => {
        if (cardRef.current) scrollIntoViewInterruptible(cardRef.current);
      });
      const newParsed = parse(raw);
      const newScore = newParsed ? score(newParsed) : 0;
      const newReps = newParsed?.reps ?? "1";
      const newE1RM = epley1RM(newScore, newReps);
      const prevBests = computePRBests(effectiveLogsAsc, sc);
      const prKind = classifyPR(
        { e1rm: newE1RM, weightKg: newScore, totalReps: totalReps(newReps, sc), tonnage: newScore * maxReps(newReps) },
        prevBests,
        oldBest,
        mode,
      );
      // Milestone (compound lifts only) outranks a Strength/Performance PR — a
      // round-weight rung is the bigger moment. It implies a weight-axis PR, so
      // it only ever pre-empts, never hides, a real PR.
      const milestone = exercise.compound ? milestoneReached(newScore, prevBests.weightKg) : null;
      // Account-wide, exercise-agnostic — checked regardless of milestone/PR so
      // it only ever surfaces via the final else-if below (a PR or round-weight
      // milestone on the same save always outranks it).
      const sessionMilestone = sessionMilestoneReached(priorSessionDates, date);
      const wStr = newParsed ? `${fmtWeightNum(newScore)} kg` : "";
      const setStr = newParsed ? `${fmtWeightNum(newScore)} kg × ${maxReps(newReps)}` : "";
      if (milestone != null) {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "milestone", title: `${milestone} kg`, sub: exercise.name });
      } else if (prKind === "strength") {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "pr", title: "Strength PR", sub: wStr || "New estimated 1RM" });
      } else if (prKind === "hypertrophy") {
        // Isolation's gold moment — a new best-set tonnage ceiling. Same confetti
        // tier as a compound Strength PR; the sub shows the set that set it.
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "pr", title: "Hypertrophy PR", sub: setStr || "New best volume" });
      } else if (prKind === "performance") {
        haptic("success");
        toast(wStr ? `Performance PR heaviest yet at ${wStr}` : "Performance PR heaviest yet", "success");
      } else if (sessionMilestone != null) {
        haptic("success");
        celebration.celebrate({ variant: "session", title: `${sessionMilestone} Sessions`, sub: "Training milestone" });
      } else {
        haptic("tap");
        toast("Set logged", "success");
      }
      // Insert the row Supabase already returned instead of a full-table
      // refetch — the log-a-set loop stays fast on a flaky connection.
      onLogAdded(newLog);
    } catch (err) {
      haptic("error");
      toast(String((err as Error)?.message ?? err), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(
    log: TrainingLog,
    raw: string,
    date: string,
    note: string,
  ) {
    if (editSubmitting) return;
    setEditSubmitting(true);
    try {
      const parsed = parse(raw);
      if (!parsed || !Number.isFinite(parsed.weight)) throw new Error("Cannot parse");
      // Same one-per-day guard as add: block moving this entry onto a date
      // another entry already occupies (self excluded, so an in-place edit is fine).
      if (effectiveLogs.some((l) => l.id !== log.id && l.log_date === date)) {
        throw new Error("Another entry already exists on that day");
      }
      const editScore = score(parsed);
      const newE1RM = epley1RM(editScore, parsed.reps);
      // Measure against every OTHER log (self excluded), so re-saving the record
      // row doesn't read as beating itself. Editing the reigning best is never a
      // fresh PR — same guard the old `log.id !== oldBest` check gave.
      const priorAsc = effectiveLogsAsc.filter((l) => l.id !== log.id);
      const isReigningBest = log.id === stats.best?.log.id;
      const editPrevBests = computePRBests(priorAsc, sc);
      const prKind = isReigningBest
        ? null
        : classifyPR(
            { e1rm: newE1RM, weightKg: editScore, totalReps: totalReps(parsed.reps, sc), tonnage: editScore * maxReps(parsed.reps) },
            editPrevBests,
            computeStats(priorAsc, sc, mode).best,
            mode,
          );
      const milestone =
        !isReigningBest && exercise.compound ? milestoneReached(editScore, editPrevBests.weightKg) : null;
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
      setEditingLogId(null);
      setSavedRowId(log.id);
      setTimeout(() => setSavedRowId(null), CLEAR_AFTER_SHEEN);
      haptic("tap");
      if (milestone != null) {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "milestone", title: `${milestone} kg`, sub: exercise.name });
      } else if (prKind === "strength") {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "pr", title: "Strength PR", sub: `${fmtWeightNum(editScore)} kg` });
      } else if (prKind === "hypertrophy") {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), CLEAR_AFTER_SHEEN);
        haptic("success");
        celebration.celebrate({ variant: "pr", title: "Hypertrophy PR", sub: `${fmtWeightNum(editScore)} kg × ${maxReps(parsed.reps)}` });
      } else if (prKind === "performance") {
        haptic("success");
        toast(`Performance PR heaviest yet at ${fmtWeightNum(editScore)} kg`, "success");
      } else {
        toast("Entry updated", "success");
      }
      onLogged();
    } catch (err) {
      haptic("error");
      toast(String((err as Error)?.message ?? err), "error");
    } finally {
      setEditSubmitting(false);
    }
  }

  function handleDelete(log: TrainingLog) {
    haptic("tap");
    const UNDO_MS = 5000;
    const record = {
      undone: false,
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    };
    setDeletedLogIds((prev) => new Set([...prev, log.id]));
    setEditingLogId(null);
    record.timer = setTimeout(async () => {
      if (record.undone) return;
      pendingLogDeletesRef.current.delete(log.id);
      try {
        await deleteLog(log.id);
        onLogged();
      } catch (err) {
        setDeletedLogIds((prev) => {
          const s = new Set(prev);
          s.delete(log.id);
          return s;
        });
        toast(String((err as Error)?.message ?? err), "error");
      }
    }, UNDO_MS);
    pendingLogDeletesRef.current.set(log.id, record);
    toast("Entry deleted", "info", UNDO_MS, {
      label: "Undo",
      onClick: () => {
        record.undone = true;
        pendingLogDeletesRef.current.delete(log.id);
        clearTimeout(record.timer);
        setDeletedLogIds((prev) => {
          const s = new Set(prev);
          s.delete(log.id);
          return s;
        });
      },
    });
  }

  async function archiveExercise() {
    try {
      const ex = await updateExercise(exercise.slug, { archived: true });
      onUpdate(ex);
      toast("Exercise archived", "info", 5000, {
        label: "Undo",
        onClick: async () => {
          try {
            const restored = await updateExercise(exercise.slug, { archived: false });
            onUpdate(restored);
          } catch (err) {
            toast(String((err as Error)?.message ?? err), "error");
          }
        },
      });
    } catch (err) {
      toast(String((err as Error)?.message ?? err), "error");
    }
  }

  const best = stats.best;
  const bestParsed = best?.log.raw ? parse(best.log.raw) : null;
  const imgSrc =
    localImageUrl ??
    exercise.image_url ??
    `${import.meta.env.BASE_URL}images/${exercise.split}/${exercise.slug}.png`;

  async function handleImageUpload(file: File): Promise<string> {
    const blob = URL.createObjectURL(file);
    setLocalImageUrl(blob);
    setUploading(true);
    setUploadError(undefined);
    try {
      const url = await uploadExerciseImage(exercise.split as SplitId, exercise.slug, file);
      onUpdate({ ...exercise, image_url: url });
      URL.revokeObjectURL(blob);
      setLocalImageUrl(undefined);
      return url;
    } catch (err) {
      const errorMsg = String((err as Error)?.message ?? err);
      setUploadError(errorMsg);
      setLocalImageUrl(undefined);
      throw err;
    } finally {
      setUploading(false);
    }
  }

  return (
    <article id={`ex-card-${exercise.slug}`} className="ex-card" ref={cardRef}>
      {celebration.node}
      {/* ── Card menu (owner only) ── */}
      {!readOnly && (
      <div className="ex-card-menu" ref={menuRef}>
        <button
          type="button"
          className={`card-menu-btn${menuOpen ? " menu-on" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Exercise options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          ⋯
        </button>
        {menuT.mounted && (
          <div className={`menu-popup card-menu-popup${menuT.closing ? " is-closing" : ""}`} role="menu">
            <button
              type="button"
              className="menu-item card-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setEditingMode("meta");
              }}
            >
              <EditIcon className="menu-icon" />
              <span>Edit exercise</span>
            </button>
            <button
              type="button"
              className="menu-item card-menu-item"
              disabled={!!isFirst || isMoving}
              onClick={async () => {
                setMenuOpen(false);
                if (!onMoveUp) return;
                setIsMoving(true);
                try {
                  await onMoveUp();
                } catch {
                  /* page handles error */
                } finally {
                  setIsMoving(false);
                }
              }}
            >
              <ArrowUpIcon className="menu-icon" />
              <span>{isMoving ? "Moving…" : "Move up"}</span>
            </button>
            <button
              type="button"
              className="menu-item card-menu-item"
              disabled={!!isLast || isMoving}
              onClick={async () => {
                setMenuOpen(false);
                if (!onMoveDown) return;
                setIsMoving(true);
                try {
                  await onMoveDown();
                } catch {
                  /* page handles error */
                } finally {
                  setIsMoving(false);
                }
              }}
            >
              <ArrowDownIcon className="menu-icon" />
              <span>{isMoving ? "Moving…" : "Move down"}</span>
            </button>
            <div className="card-menu-sep" />
            <button
              type="button"
              className="menu-item card-menu-item danger"
              onClick={() => {
                archiveExercise();
                setMenuOpen(false);
              }}
            >
              <ArchiveIcon className="menu-icon" />
              <span>Archive…</span>
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            handleImageUpload(file).catch(() => {
              // Error is already handled and displayed
            });
            e.target.value = "";
          }}
        />
      </div>
      )}

      {/* ── Header (title + body): clips the identity image at the divider ── */}
      <div className="ex-head">
      {/* ── Title block ── */}
      <div className="ex-title-block">
        <div className="ex-title-row">
          <h3 className="ex-name">
            {editingMode !== "meta" ? (
              /* Tap target is the name + chart glyph only (the glyph is the
                 cue), not the whole header — so tapping the PR number or the
                 identity photo no longer springs the trend sheet unexpectedly. */
              <button
                type="button"
                className="ex-name-trend-btn"
                onClick={() => setTrendOpen(true)}
                aria-label={`${exercise.name} — view strength trend`}
              >
                <span className="ex-name-text">{exercise.name}</span>
                <ChartGlyph className="ex-name-trend" />
              </button>
            ) : (
              <span className="ex-name-text">{exercise.name}</span>
            )}
          </h3>
          {exercise.target && (
            <span className="target-display mono">{exercise.target}</span>
          )}
        </div>
        {exercise.note && (
          <div className="ex-meta-row">
            <span className="note-display">{exercise.note}</span>
          </div>
        )}
      </div>

      {/* ── Body: PR + image ── */}
      {editingMode !== "meta" && (
        <div className="ex-body">
          <div className="ex-body-content">
            {uploadError && <div className="upload-error">{uploadError}</div>}
            <div className={`ex-pr-inline${prFlash ? " pr-just-set" : ""}`}>
              {bestParsed && Number.isFinite(bestParsed.weight) ? (
                <div className="pr-top-row">
                  <span className="pr-label">PR</span>
                  <span className="pr-weight-group">
                    <span className="pr-weight">
                      <AnimatedWeight
                        value={bestParsed.assisted ? bestParsed.assisted.assist : bestParsed.weight}
                      />{" "}
                      {bestParsed.assisted ? "kg" : isLbUnit(bestParsed.unit) ? "lb" : "kg"}
                    </span>
                    {/* assisted: hero is the assist "19 kg"; the "= lifted × reps"
                        read-out reuses .pr-meta (unit stays on the hero). expr-star
                        gives the × the same 4px spacing as every other × on screen. */}
                    <span className="pr-meta mono">
                      {bestParsed.assisted && (
                        <span className="expr-sep">= {fmtWeightNum(score(bestParsed))}</span>
                      )}
                      <span className="expr-star">×</span>
                      <span>{formatRepsDisplay(bestParsed.reps)}</span>
                    </span>
                  </span>
                </div>
              ) : (
                <span className="pr-empty">No PR yet</span>
              )}
            </div>
          </div>
          <div className="ex-ident-wrap">
            <SmartImage src={imgSrc} alt="" className="ex-ident" />
          </div>
        </div>
      )}

      </div>

      {/* ── Edit Exercise Form ── */}
      {editingMode === "meta" && (
        <EditExerciseForm
          exercise={exercise}
          onSave={async (patch) => {
            try {
              const updated = await updateExercise(exercise.slug, patch);
              onUpdate(updated);
              toast("Exercise updated", "success");
            } catch (err) {
              toast(String((err as Error)?.message ?? err), "error");
              // Rethrow so EditExerciseForm keeps the form open (it calls
              // onCancel only after a successful save) — a failed save must
              // never discard the user's edits.
              throw err;
            }
          }}
          onCancel={() => setEditingMode("view")}
          onArchive={archiveExercise}
          onPhotoUpload={handleImageUpload}
          onPhotoRemove={() => {
            onUpdate({ ...exercise, image_url: null });
          }}
          uploading={uploading}
          uploadError={uploadError}
          localImageUrl={localImageUrl}
        />
      )}

      {/* ── History ── */}
      {editingMode !== "meta" && (
        <div className="ex-history">
        {filteredDesc.length === 0 ? (
          <div className="empty-row">No sets yet — log your first below</div>
        ) : (
          visible.map((log, vi) => {
            // prIndex is index in filteredAsc; vi 0 = newest = last in asc
            const ascIdx = filteredAsc.length - 1 - vi;
            const isPR = ascIdx === prIndexInFiltered;
            const isEditing = editingLogId === log.id;
            const justSaved = savedRowId === log.id;
            const revealing = justExpanded && vi >= 3;
            const td = timelineDate(log.log_date ?? "");
            const prevLog = visible[vi + 1] ?? null;
            // Only the newest entry gets a vs-last badge — older rows stay quiet.
            const delta =
              isPR || !prevLog || vi !== 0 ? null : computeHistDelta(log, prevLog, sc, mode);
            const isAssisted = log.kind === "assisted";
            // Assisted history renders off the denormalized kind/assistance/bodyweight
            // columns when present, else falls back to parsing the raw expression:
            // rows logged as "92.99-(31)" before those columns existed carry the same
            // bw/assist losslessly in the string, so they show identically with no data
            // migration. (Scoring/PR already read the parse, so only this display was
            // inconsistent for those old rows.)
            const assistedParse = isAssisted ? null : parse(log.raw ?? "");
            const histAssist = log.assistance ?? assistedParse?.assisted?.assist ?? null;
            const histBw = log.bodyweight ?? assistedParse?.assisted?.bw ?? null;
            const isExpanded = expandedLogId === log.id && !isEditing;
            // Tap-to-reveal: this set's score and how much of the all-time PR it
            // holds — on the lift's OWN axis (compound → e1RM, isolation → best-set
            // tonnage). Numerator and denominator read the same axis as the gold
            // PR badge (stats.best is mode-picked too), so "of PR" and the gold row
            // never disagree — including for isolation lifts.
            const entry = toLogEntry(log, sc);
            const entryScore = entry ? (mode === "isolation" ? entry.tonnage : entry.e1rm) : 0;
            const bestScore = stats.best ? (mode === "isolation" ? stats.best.tonnage : stats.best.e1rm) : 0;
            const retention =
              entryScore > 0 && bestScore > 0
                ? Math.round((entryScore / bestScore) * 100)
                : null;

            return (
              <div
                key={log.id}
                className={[
                  "hist-entry",
                  isExpanded ? "is-open" : "",
                  isPR ? "is-pr" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div
                  className={[
                    "hist-row",
                    isPR ? "is-pr" : "",
                    isEditing ? "is-editing" : "",
                    justSaved ? "hist-row-saved" : "",
                    revealing ? "hist-row-reveal" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    revealing ? { animationDelay: `${(vi - 3) * 32}ms` } : undefined
                  }
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={(e) => {
                    if (isEditing) return;
                    toggleExpanded(log.id, e.currentTarget.parentElement);
                  }}
                  onKeyDown={(e) => {
                    if (isEditing) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpanded(log.id, e.currentTarget.parentElement);
                    }
                  }}
                >
                  <span className="hist-date" title={log.log_date ?? ""}>
                    <span className="hist-date-mon">{td.mon}</span>
                    <span className="hist-date-day mono">{td.day}</span>
                  </span>

                  <span className="hist-expr">
                    {histBw != null && histAssist != null ? (
                      <span className="hist-assisted-wrap">
                        <strong className="expr-weight-primary">{fmtWeightNum(histAssist)}</strong>
                        <span className="expr-sep">=</span>
                        <span className="expr-unit-tag">{fmtWeightNum(histBw - histAssist)}</span>
                        <span className="expr-unit-tag">kg</span>
                        <span className="expr-star">×</span>
                        <span className="expr-reps">{formatRepsDisplay(log.reps ?? assistedParse?.reps ?? "")}</span>
                      </span>
                    ) : (
                      <span className="hist-expr-row">
                        <ExprDisplay raw={log.raw} histMode />
                      </span>
                    )}
                    {log.note && (
                      <span className="hist-note">{log.note}</span>
                    )}
                  </span>

                  <span className="hist-change">
                    {isEditing ? null : isPR ? (
                      <span
                        className="hist-status hist-status-pr"
                        aria-label="Personal record"
                      >
                        PR
                      </span>
                    ) : delta ? (
                      <span className={`hist-status hist-status-${delta.direction}`}>
                        {delta.text}
                      </span>
                    ) : null}
                  </span>

                  <div className="hist-row-end">
                    <div className="hist-actions">
                      {!readOnly && (
                        <button
                          type="button"
                          title="Edit entry"
                          disabled={deletedLogIds.size > 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMode("view");
                            setExpandedLogId(null);
                            setEditingLogId(isEditing ? null : log.id);
                          }}
                          className="hist-edit-btn"
                        >
                          <PenLineIcon />
                        </button>
                      )}
                    </div>
                    {/* Disclosure cue — signals the row body expands (Est.1RM / of
                        PR / Volume), distinct from the pen's edit action. Not a
                        button: it's part of the row, which owns the toggle. */}
                    {!isEditing && (
                      <span className="hist-disclosure" aria-hidden="true">
                        <svg width="11" height="7" viewBox="0 0 12 7" fill="none">
                          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                  {justSaved && (
                    <svg
                      className="hist-row-check"
                      viewBox="0 0 22 22"
                      aria-hidden="true"
                    >
                      <circle
                        className="hist-row-check-circle"
                        cx="11"
                        cy="11"
                        r="11"
                        fill="var(--accent)"
                      />
                      <polyline
                        className="hist-row-check-tick"
                        points="6,11.5 9.5,15 16,7.5"
                        pathLength="1"
                      />
                    </svg>
                  )}
                </div>

                {isExpanded && (
                  <div className="hist-detail-clip">
                  <div className="hist-detail-drawer">
                    <div className="hist-detail">
                      {/* Compound shows Est. 1RM (kg); isolation shows best-set
                          Volume (weight × reps) — the axis it's actually judged on.
                          Tonnage is a kg·reps product, not a weight, so it is NOT
                          run through fmtWeightNum's lb conversion. */}
                      <span className="hist-detail-k">{mode === "isolation" ? "Volume" : "Est. 1RM"}</span>
                      <span className="hist-detail-v mono">
                        {entryScore > 0
                          ? mode === "isolation"
                            ? `${Math.round(entryScore)} vol`
                            : `${fmtWeightNum(Math.round(entryScore * 10) / 10)} kg`
                          : "—"}
                      </span>
                    </div>
                    <div className="hist-detail">
                      <span className="hist-detail-k">of PR</span>
                      <span
                        className={`hist-detail-v mono${
                          retention != null && retention >= 100 ? " is-pr" : ""
                        }`}
                      >
                        {retention != null ? `${retention}%` : "—"}
                      </span>
                    </div>
                    <div className="hist-detail">
                      <span className="hist-detail-k">Volume</span>
                      <span className="hist-detail-v mono">
                        {entry && entry.weightKg > 0 && entry.totalReps > 0
                          ? `${fmtWeightNum(
                              Math.round(entry.weightKg * entry.totalReps),
                            )} kg`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  </div>
                )}

                {(isEditing ||
                  (editorT.closing && closingLogIdRef.current === log.id)) && (
                  <div
                    className={`ex-editor-drawer${
                      !isEditing && editorT.closing ? " is-closing" : ""
                    }`}
                  >
                    <div className="ex-editor-drawer-inner">
                      {isAssisted ? (
                        <InlineEditAssistedEntry
                          log={log}
                          setCount={sc}
                          submitting={editSubmitting}
                          onSave={(raw, date, note) =>
                            handleEdit(log, raw, date, note)
                          }
                          onCancel={() => setEditingLogId(null)}
                          onDelete={() => handleDelete(log)}
                        />
                      ) : (
                        <InlineEditEntry
                          log={log}
                          setCount={sc}
                          submitting={editSubmitting}
                          onSave={(raw, date, note) =>
                            handleEdit(log, raw, date, note)
                          }
                          onCancel={() => setEditingLogId(null)}
                          onDelete={() => handleDelete(log)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
        </div>
      )}

      {/* ── Log set form (owner only) ── */}
      {/* Wrapped in the editor drawer so the add form unfolds (height 0fr→1fr)
          on open, same as inline-edit. is-add zeroes the inner padding so the
          form's own spacing is preserved 1:1. */}
      {!readOnly && editingMode === "logset" && (
        <div className="ex-editor-drawer is-add">
          <div className="ex-editor-drawer-inner">
            {addAssisted ? (
              <AddAssistedForm
                setCount={sc}
                lastLog={effectiveLogs[0] ?? null}
                onAdd={handleAdd}
                onCancel={() => setEditingMode("view")}
                submitting={submitting}
              />
            ) : (
              <AddEntryForm
                setCount={sc}
                lastRaw={effectiveLogs.find((l) => l.kind !== "assisted")?.raw ?? ""}
                onAdd={handleAdd}
                onCancel={() => setEditingMode("view")}
                submitting={submitting}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Footer: Log set link + View all ── */}
      {editingMode !== "meta" &&
        editingMode !== "logset" &&
        (!readOnly && editingLogId == null || filteredDesc.length > 2) && (
        <div className="ex-footer">
          {!readOnly && editingLogId == null && (
            <button
              type="button"
              className="ex-log-link"
              onClick={() => setEditingMode("logset")}
            >
              <PlusIcon className="ex-log-plus" />
              <span className="ex-log-text">Log set</span>
            </button>
          )}
          {filteredDesc.length > 2 && (
            <button
              type="button"
              className="ex-view-all"
              onClick={() => {
                const next = !showAll;
                setShowAll(next);
                if (next) {
                  setJustExpanded(true);
                  setTimeout(() => setJustExpanded(false), 700);
                }
              }}
            >
              {showAll ? "Recent only" : `View all ${filteredDesc.length}`}
            </button>
          )}
        </div>
      )}

      <TrendSheet
        exercise={exercise}
        logs={effectiveLogs}
        open={trendOpen}
        onClose={() => setTrendOpen(false)}
      />
    </article>
  );
}
