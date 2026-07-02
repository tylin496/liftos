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
  buildStagnationView,
  epley1RM,
  type TimeFilter,
} from "./logic";
import { useToast } from "@shared/components/Toast";
import { ExprDisplay, fmtWeightNum, isLbUnit } from "./ExprDisplay";
import { defaultSetCount } from "./logFormHelpers";
import { AddEntryForm, AddAssistedForm, InlineEditEntry, InlineEditAssistedEntry } from "./LogForms";
import { StagnationBadge, StagnationDetail } from "./StagnationBadge";
import { useExitTransition } from "@shared/hooks/useExitTransition";
import { useCelebration } from "@shared/components/Celebration";
import { haptic } from "@shared/lib/haptics";

export { useToast };


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

  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [justExpanded, setJustExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [prFlash, setPrFlash] = useState(false);
  const [newLogId, setNewLogId] = useState<string | null>(null);
  const [retOpen, setRetOpen] = useState(false);
  const [deletedLogIds, setDeletedLogIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const [metaTarget, setMetaTarget] = useState(exercise.target ?? "");
  const [metaNote, setMetaNote] = useState(exercise.note ?? "");

  const [submitting, setSubmitting] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  // Stats use ALL logs (unfiltered, undeleted) so the PR badge/confetti reflect
  // the all-time record, not just what's inside the current time-filter window.
  const stats = useMemo(() => computeStats(effectiveLogsAsc), [effectiveLogsAsc]);
  // Index of the all-time-best log within the currently displayed (filtered) window,
  // so the history list can still highlight it when it's visible.
  const prIndexInFiltered = useMemo(
    () => (stats.best ? filteredAsc.indexOf(stats.best.log) : -1),
    [filteredAsc, stats.best],
  );
  const stagView = useMemo(() => buildStagnationView(effectiveLogsAsc), [effectiveLogsAsc]);

  // For display: newest first
  const filteredDesc = useMemo(() => [...filteredAsc].reverse(), [filteredAsc]);
  const visibleCount = showAll ? filteredDesc.length : Math.min(2, filteredDesc.length);
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
      .catch((err) => toast(String((err as Error)?.message ?? err), "error"));
  }

  async function handleAdd(raw: string, date: string, note: string) {
    if (submitting) return;
    setSubmitting(true);
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
      const newE1RM = epley1RM(newScore, newParsed?.reps ?? "1");
      if (newE1RM > oldBestE1RM) {
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
      const newE1RM = epley1RM(score(parsed), parsed.reps);
      const oldBestE1RM = stats.best?.e1rm ?? 0;
      const isNewPR = newE1RM > oldBestE1RM && log.id !== stats.best?.log.id;
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
    let undone = false;
    const UNDO_MS = 5000;
    setDeletedLogIds((prev) => new Set([...prev, log.id]));
    setEditId(null);
    const commit = setTimeout(async () => {
      if (undone) return;
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
    toast("Entry deleted", "info", UNDO_MS, {
      label: "Undo",
      onClick: () => {
        undone = true;
        clearTimeout(commit);
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
      toast(`${exercise.name} archived`, "info", 5000, {
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

  const sc = defaultSetCount(exercise);
  const best = stats.best;
  const bestParsed = best?.log.raw ? parse(best.log.raw) : null;
  const imgSrc =
    localImageUrl ??
    exercise.image_url ??
    `${import.meta.env.BASE_URL}images/${exercise.split}/${exercise.slug}.png`;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = URL.createObjectURL(file);
    setLocalImageUrl(blob);
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadExerciseImage(exercise.slug, file);
      onUpdate({ ...exercise, image_url: url });
      URL.revokeObjectURL(blob);
      setLocalImageUrl(null);
    } catch (err) {
      setUploadError(String((err as Error)?.message ?? err));
      setLocalImageUrl(null);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <article className="ex-card" ref={cardRef}>
      {celebration.node}
      {/* ── Card menu ── */}
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
              {isMoving ? "Moving…" : "↑ Move up"}
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
              {isMoving ? "Moving…" : "↓ Move down"}
            </button>
            <button
              type="button"
              className="menu-item card-menu-item"
              disabled={uploading}
              onClick={() => {
                fileInputRef.current?.click();
                setMenuOpen(false);
              }}
            >
              {uploading ? "Uploading…" : "Upload photo"}
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
              Archive…
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleImageUpload}
        />
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
                  .catch((err) => toast(String((err as Error)?.message ?? err), "error"));
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
            size={Math.max((metaTarget || "target").length, 4)}
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
          {uploadError && <div className="upload-error">{uploadError}</div>}
          <div className={`ex-pr-inline${prFlash ? " pr-just-set" : ""}`}>
            {bestParsed && Number.isFinite(bestParsed.weight) ? (
              <div className="pr-top-row">
                <span className="pr-label">PR</span>
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
          <StagnationBadge
            view={stagView}
            open={retOpen}
            onToggle={() => setRetOpen((v) => !v)}
          />
          <StagnationDetail view={stagView} open={retOpen} />
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
            const isPR = ascIdx === prIndexInFiltered;
            const isEditing = editId === log.id;
            const isNew = newLogId === log.id;
            const revealing = justExpanded && vi >= 3;
            const td = timelineDate(log.log_date ?? "");
            const prevLog = visible[vi + 1] ?? null;
            const delta = isPR || !prevLog ? null : computeHistDelta(log, prevLog);
            const isAssisted = log.kind === "assisted";
            const isExpanded = expandedId === log.id;
            const rowE1RM = isAssisted
              ? log.bodyweight != null && log.assistance != null
                ? epley1RM(log.bodyweight - log.assistance, log.reps ?? "1")
                : null
              : (() => {
                  const p = log.raw ? parse(log.raw) : null;
                  return p && Number.isFinite(p.weight)
                    ? epley1RM(score(p), p.reps)
                    : null;
                })();

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
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId((id) => (id === log.id ? null : log.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId((id) => (id === log.id ? null : log.id));
                    }
                  }}
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
                        <ExprDisplay raw={log.raw} histMode />
                      </span>
                    )}
                    {log.note && (
                      <span className="hist-note">{log.note}</span>
                    )}
                  </span>

                  <span className="hist-change">
                    {isPR ? (
                      <span
                        className="hist-status hist-status-pr"
                        aria-label="Personal record"
                      >
                        PR
                      </span>
                    ) : delta ? (
                      <span className="hist-status hist-status-gain">{delta.text}</span>
                    ) : null}
                  </span>

                  <div className="hist-row-end">
                    <div className="hist-actions">
                      <button
                        type="button"
                        title="Edit entry"
                        disabled={deletedLogIds.size > 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAdding(false);
                          setEditId(isEditing ? null : log.id);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && !isEditing && (
                  <div className="hist-e1rm-detail">
                    <span className="hist-e1rm-label">Est. 1RM</span>
                    <span className="hist-e1rm-value mono">
                      {rowE1RM != null ? `${fmtWeightNum(rowE1RM)} kg` : "—"}
                    </span>
                  </div>
                )}

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

      {/* ── Log set form or button ── */}
      {adding ? (
        effectiveLogs[0]?.kind === "assisted" ? (
          <AddAssistedForm
            setCount={sc}
            lastLog={effectiveLogs[0] ?? null}
            onAdd={handleAdd}
            onCancel={() => setAdding(false)}
            submitting={submitting}
          />
        ) : (
          <AddEntryForm
            setCount={sc}
            lastRaw={effectiveLogs.find((l) => l.kind !== "assisted")?.raw ?? ""}
            onAdd={handleAdd}
            onCancel={() => setAdding(false)}
            submitting={submitting}
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

      {/* ── Show more ── */}
      {filteredDesc.length > 2 && !adding && (
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
    </article>
  );
}
