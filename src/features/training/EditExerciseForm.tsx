import { useRef, useState } from "react";
import { ImageWell } from "./ImageWell";
import { inferAssisted, normalizeTarget, useScrollAboveKeyboard } from "./logFormHelpers";
import { asMuscleGroup, inferMuscleGroup, MUSCLE_GROUPS } from "./muscleGroup";
import type { Exercise } from "./api";

/** "hamstrings" → "Hamstrings" — the option list's display case. */
function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

export interface EditExerciseFormProps {
  exercise: Exercise;
  onSave: (patch: Partial<Exercise>) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => Promise<void>;
  onPhotoUpload?: (file: File) => Promise<string>;
  onPhotoRemove?: () => void;
  uploading?: boolean;
  uploadError?: string;
  localImageUrl?: string;
}

export function EditExerciseForm({
  exercise,
  onSave,
  onCancel,
  onArchive,
  onPhotoUpload,
  onPhotoRemove,
  uploading = false,
  uploadError,
  localImageUrl,
}: EditExerciseFormProps) {
  const [name, setName] = useState(exercise.name);
  const [target, setTarget] = useState(exercise.target ?? "");
  const [note, setNote] = useState(exercise.note ?? "");
  const [compound, setCompound] = useState(exercise.compound);
  // "" = trust inference (stored as null); a group name pins the muscle.
  // Tolerant read: rows fetched before migration 0018 have no override field.
  const [muscle, setMuscle] = useState(asMuscleGroup(exercise.muscle_group_override) ?? "");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-focuses the name field on open — keep the Save button above the
  // keyboard, consistent with the log/add forms.
  useScrollAboveKeyboard(formRef);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        target: normalizeTarget(target) || null,
        note: note.trim() || null,
        assisted_mode: inferAssisted(name),
        compound,
        // Only sent when actually changed: an update naming a column that
        // doesn't exist yet errors in PostgREST, so an untouched select must
        // not break saves made before migration 0018 is applied.
        ...(muscle !== (asMuscleGroup(exercise.muscle_group_override) ?? "")
          ? { muscle_group_override: muscle || null }
          : {}),
      });
      onCancel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-exercise-form" ref={formRef} onSubmit={handleSubmit}>
      <div className="edit-exercise-topbar">
        <button
          type="button"
          className="edit-exercise-dismiss"
          onClick={onCancel}
          aria-label="Dismiss"
        >
          ✕
        </button>
        <h2 className="edit-exercise-title">Edit exercise</h2>
      </div>

      <ImageWell
        src={exercise.image_url ?? undefined}
        localUrl={localImageUrl}
        onUpload={onPhotoUpload}
        onRemove={onPhotoRemove}
        uploading={uploading}
        error={uploadError}
      />

      <div className="edit-exercise-fields">
        <input
          type="text"
          className="field-input name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Exercise name"
          autoFocus
          aria-label="Name"
        />

        <div className="edit-exercise-row">
          <input
            type="text"
            className="field-input target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="target"
            aria-label="Target / sets"
          />
          <input
            type="text"
            className="field-input note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note"
            aria-label="Note"
            maxLength={80}
          />
        </div>

        {/* Compound lifts get round-weight Milestone celebrations (see
            milestone.ts); machine isolations don't. */}
        <label className="add-ex-opt">
          <input
            type="checkbox"
            checked={compound}
            onChange={(e) => setCompound(e.target.checked)}
          />
          Compound lift
        </label>
        {/* Primary limiting muscle — feeds the muscle grid, cluster fatigue and
            weekly-volume buckets. "Auto" trusts inference (muscleGroup.ts);
            picking a group pins it, for the rare misclassification only. */}
        <label className="edit-exercise-muscle">
          Primary muscle
          <select
            className="field-input edit-exercise-muscle-select"
            value={muscle}
            onChange={(e) => setMuscle(e.target.value)}
          >
            <option value="">
              Auto — {capitalize(inferMuscleGroup(name, exercise.slug, exercise.split))}
            </option>
            {MUSCLE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {capitalize(g)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="edit-exercise-actions">
        <button type="submit" className="btn-log-primary" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-log-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {onArchive && (
        <button
          type="button"
          className="edit-exercise-archive-link"
          onClick={onArchive}
        >
          Archive exercise
        </button>
      )}
    </form>
  );
}
