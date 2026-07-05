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
import {
  computeStats,
  computeHistDelta,
  filterByTime,
  timelineDate,
  toLogEntry,
  epley1RM,
  beatsBest,
  totalReps,
  type TimeFilter,
} from "./logic";
import { useToast } from "@shared/components/Toast";
import { ExprDisplay, fmtWeightNum, isLbUnit } from "./ExprDisplay";
import { defaultSetCount } from "./logFormHelpers";
import { AddEntryForm, AddAssistedForm, InlineEditEntry, InlineEditAssistedEntry } from "./LogForms";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useCelebration } from "@shared/components/Celebration";
import { haptic } from "@shared/lib/haptics";
import { EditExerciseForm } from "./EditExerciseForm";
import { TrendSheet } from "./TrendSheet";
import { EditIcon, PenLineIcon, ArrowUpIcon, ArrowDownIcon, ArchiveIcon } from "./EditIcon";
import { AnimatedNumber } from "@shared/components/AnimatedNumber";
import { useIsReadOnly } from "@app/layout/SessionContext";

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

export interface ExerciseCardProps {
  exercise: Exercise;
  logs: TrainingLog[]; // newest-first (as returned by fetchLogsBySlug)
  timeFilter: TimeFilter;
  onLogged: () => void;
  onLogAdded: (log: TrainingLog) => void;
  onUpdate: (patch: Partial<Exercise>) => void;
  onMoveUp?: () => Promise<void>;
  onMoveDown?: () => Promise<void>;
  isFirst?: boolean;
  isLast?: boolean;
}

export function ExerciseCard({
  exercise,
  logs,
  timeFilter,
  onLogged,
  onLogAdded,
  onUpdate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ExerciseCardProps) {
  const toast = useToast();
  const celebration = useCelebration();
  const readOnly = useIsReadOnly();

  type EditingMode = "view" | "meta" | "logset" | "edithist";

  const [editingMode, setEditingMode] = useState<EditingMode>("view");
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [justExpanded, setJustExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [prFlash, setPrFlash] = useState(false);
  const [newLogId, setNewLogId] = useState<string | null>(null);
  const [deletedLogIds, setDeletedLogIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [localImageUrl, setLocalImageUrl] = useState<string>();
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);

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
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
  // Stats use ALL logs (unfiltered, undeleted) so the PR badge/confetti reflect
  // the all-time record, not just what's inside the current time-filter window.
  const stats = useMemo(() => computeStats(effectiveLogsAsc, sc), [effectiveLogsAsc, sc]);
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
      setNewLogId(newLog.id);
      setTimeout(() => setNewLogId(null), 1200);
      requestAnimationFrame(() => {
        if (cardRef.current) scrollIntoViewInterruptible(cardRef.current);
      });
      const newParsed = parse(raw);
      const newScore = newParsed ? score(newParsed) : 0;
      const newReps = newParsed?.reps ?? "1";
      const newE1RM = epley1RM(newScore, newReps);
      const isNewPR = beatsBest({ e1rm: newE1RM, totalReps: totalReps(newReps, sc) }, oldBest);
      if (isNewPR) {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), 1100);
        haptic("success");
        const wStr = newParsed ? `${fmtWeightNum(score(newParsed))} kg` : "";
        celebration.celebrate({ variant: "pr", sub: wStr || "Personal record" });
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
    try {
      const parsed = parse(raw);
      if (!parsed || !Number.isFinite(parsed.weight)) throw new Error("Cannot parse");
      // Same one-per-day guard as add: block moving this entry onto a date
      // another entry already occupies (self excluded, so an in-place edit is fine).
      if (effectiveLogs.some((l) => l.id !== log.id && l.log_date === date)) {
        throw new Error("Another entry already exists on that day");
      }
      const newE1RM = epley1RM(score(parsed), parsed.reps);
      const oldBest = stats.best;
      const isNewPR =
        log.id !== oldBest?.log.id &&
        beatsBest({ e1rm: newE1RM, totalReps: totalReps(parsed.reps, sc) }, oldBest);
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
      setTimeout(() => setSavedRowId(null), 1200);
      haptic("tap");
      if (isNewPR) {
        setPrFlash(true);
        setTimeout(() => setPrFlash(false), 1100);
        haptic("success");
        celebration.celebrate({ variant: "pr", sub: `${fmtWeightNum(score(parsed))} kg` });
      } else {
        toast("Entry updated", "success");
      }
      onLogged();
    } catch (err) {
      haptic("error");
      toast(String((err as Error)?.message ?? err), "error");
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
      const url = await uploadExerciseImage(exercise.slug, file);
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
    <article className="ex-card" ref={cardRef}>
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
            <button
              type="button"
              className="ex-name-btn"
              onClick={() => setTrendOpen(true)}
              aria-label={`${exercise.name} — view strength trend`}
            >
              <span className="ex-name-text">{exercise.name}</span>
              <ChartGlyph className="ex-name-trend" />
            </button>
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
                        value={bestParsed.assisted ? score(bestParsed) : bestParsed.weight}
                      />{" "}
                      {bestParsed.assisted ? "kg" : isLbUnit(bestParsed.unit) ? "lb" : "kg"}
                    </span>
                    <span className="pr-meta mono">×{formatRepsDisplay(bestParsed.reps)}</span>
                  </span>
                  {bestParsed.assisted && (
                    <span className="pr-kg-hint">{bestParsed.assisted.assist} kg assist</span>
                  )}
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
              setEditingMode("view");
              toast("Exercise updated", "success");
            } catch (err) {
              toast(String((err as Error)?.message ?? err), "error");
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
            const isNew = newLogId === log.id;
            const revealing = justExpanded && vi >= 3;
            const td = timelineDate(log.log_date ?? "");
            const prevLog = visible[vi + 1] ?? null;
            // Only the newest entry gets a vs-last badge — older rows stay quiet.
            const delta =
              isPR || !prevLog || vi !== 0 ? null : computeHistDelta(log, prevLog, sc);
            const isAssisted = log.kind === "assisted";

            return (
              <div key={log.id}>
                <div
                  className={[
                    "hist-row",
                    isPR ? "is-pr" : "",
                    isEditing ? "is-editing" : "",
                    isNew ? "hist-row-new" : "",
                    savedRowId === log.id ? "hist-row-saved" : "",
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
                        <span className="hist-expr-row">
                          <span className="mono">
                            <strong>
                              {fmtWeightNum(log.bodyweight - log.assistance)}
                            </strong>
                            <span className="expr-sep">
                              {" "}
                              ×{formatRepsDisplay(log.reps ?? "")}
                            </span>
                          </span>
                        </span>
                        <span className="hist-assist-sub">
                          {log.assistance} kg assist
                        </span>
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
                          onClick={() => {
                            setEditingMode("view");
                            setEditingLogId(isEditing ? null : log.id);
                          }}
                          className="hist-edit-btn"
                        >
                          <PenLineIcon />
                        </button>
                      )}
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
                        onCancel={() => setEditingLogId(null)}
                        onDelete={() => handleDelete(log)}
                      />
                    ) : (
                      <InlineEditEntry
                        log={log}
                        setCount={sc}
                        onSave={(raw, date, note) =>
                          handleEdit(log, raw, date, note)
                        }
                        onCancel={() => setEditingLogId(null)}
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
      )}

      {/* ── Log set form or button (owner only) ── */}
      {!readOnly && (editingMode === "logset" ? (
        addAssisted ? (
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
        )
      ) : editingMode === "view" && editingLogId == null ? (
        <button
          type="button"
          className="hist-add"
          onClick={() => {
            setEditingMode("logset");
          }}
        >
          <span className="hist-add-plus">＋</span>
          <span className="hist-add-text">Log set</span>
        </button>
      ) : null)}

      {/* ── Show more ── */}
      {editingMode !== "meta" && filteredDesc.length > 2 && editingMode !== "logset" && (
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
            ? `Show recent only (${filteredDesc.length} total)`
            : `View all ${filteredDesc.length} entries`}
        </button>
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
