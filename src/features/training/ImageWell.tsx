import { useState, useRef } from "react";

export interface ImageWellProps {
  src?: string;
  onUpload?: (file: File) => Promise<string>; // Returns new URL
  onRemove?: () => void;
  uploading?: boolean;
  error?: string;
  localUrl?: string;
}

export function ImageWell({
  src,
  onUpload,
  onRemove,
  uploading = false,
  error,
  localUrl,
}: ImageWellProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const displaySrc = localUrl || src;
  const isLoading = uploading || isUploading;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;

    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="image-well">
      <div className="image-well-container">
        {displaySrc ? (
          <>
            <img
              src={displaySrc}
              alt="Exercise"
              className="image-well-img"
            />
            {isLoading && <div className="image-well-overlay" />}
          </>
        ) : (
          <div className="image-well-empty">
            <div className="image-well-empty-icon">+</div>
            <div className="image-well-empty-text">No photo yet</div>
          </div>
        )}
      </div>

      <div className="image-well-actions">
        <button
          type="button"
          className="btn-image-action"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          {displaySrc ? "Change photo" : "Add photo"}
        </button>
        {displaySrc && (
          <button
            type="button"
            className="btn-image-remove"
            onClick={onRemove}
            disabled={isLoading}
          >
            Remove
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
      </div>

      {error && <div className="image-well-error">{error}</div>}

      <div className="image-well-hint">
        Cutouts (transparent PNG) look best — they float over the card with no
        background.
      </div>
    </div>
  );
}
