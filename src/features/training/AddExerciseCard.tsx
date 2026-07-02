import { useState } from "react";
import { ImageWell } from "./ImageWell";
import type { Exercise } from "./api";

export interface AddExerciseCardProps {
  split: string;
  onAdd: (exercise: Omit<Exercise, "id" | "user_id" | "created_at">) => Promise<void>;
  onCancel: () => void;
  uploading?: boolean;
  uploadError?: string;
}

export function AddExerciseCard({
  split,
  onAdd,
  onCancel,
  uploading = false,
  uploadError,
}: AddExerciseCardProps) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [assistedMode, setAssistedMode] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>();
  const [localImageUrl, setLocalImageUrl] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function handlePhotoUpload(file: File): Promise<string> {
    const blob = URL.createObjectURL(file);
    setLocalImageUrl(blob);
    // In a real implementation, this would upload to a service
    // For now, we'll just use the blob URL as a placeholder
    const url = blob;
    setImageUrl(url);
    URL.revokeObjectURL(blob);
    setLocalImageUrl(undefined);
    return url;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onAdd({
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        split,
        name: name.trim(),
        target: target.trim() || null,
        note: note.trim() || null,
        assisted_mode: assistedMode,
        image_url: imageUrl || null,
        sort_order: 0, // Will be set by the caller
      } as any);
      onCancel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="ex-card add-exercise-card">
      <form onSubmit={handleSubmit}>
        <div className="add-exercise-topbar">
          <button
            type="button"
            className="edit-exercise-dismiss"
            onClick={onCancel}
            aria-label="Cancel"
          >
            ✕
          </button>
          <h2 className="edit-exercise-title">Add exercise</h2>
        </div>

        <div className="add-exercise-split-row">
          <div className="split-seg" role="group" aria-label="Split">
            <button
              type="button"
              className={`seg-btn${split === "push" ? " on" : ""}`}
              disabled
            >
              Push
            </button>
            <button
              type="button"
              className={`seg-btn${split === "pull" ? " on" : ""}`}
              disabled
            >
              Pull
            </button>
            <button
              type="button"
              className={`seg-btn${split === "legs" ? " on" : ""}`}
              disabled
            >
              Legs
            </button>
          </div>
        </div>

        <ImageWell
          src={imageUrl}
          localUrl={localImageUrl}
          onUpload={handlePhotoUpload}
          onRemove={() => {
            setImageUrl(undefined);
            setLocalImageUrl(undefined);
          }}
          uploading={uploading}
          error={uploadError}
        />

        <div className="add-exercise-fields">
          <input
            type="text"
            className="field-input name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Exercise name"
            autoFocus
            aria-label="Name"
            required
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

          <label className="assisted-mode-label">
            <input
              type="checkbox"
              checked={assistedMode}
              onChange={(e) => setAssistedMode(e.target.checked)}
              aria-label="Assisted mode"
            />
            <span>Assisted exercise</span>
          </label>
        </div>

        <div className="edit-exercise-actions">
          <button
            type="submit"
            className="btn-log-primary"
            disabled={saving || !name.trim()}
          >
            {saving ? "Adding…" : "Add exercise"}
          </button>
          <button type="button" className="btn-log-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </article>
  );
}
