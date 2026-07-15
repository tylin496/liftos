import { lazy, Suspense, useRef, useState } from "react";

// Cropping is a rare action (adding/replacing a photo), and the modal pulls in
// react-easy-crop. Load it only when the crop modal actually opens so the whole
// library stays out of the Training tab's initial bundle.
const ImageCropModal = lazy(() =>
  import("./ImageCropModal").then((m) => ({ default: m.ImageCropModal })),
);

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
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);

  const displaySrc = localUrl || src;
  const isLoading = uploading || isUploading;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPending({ url: URL.createObjectURL(file), name: file.name });
  }

  function closeCropModal() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
  }

  async function handleCropConfirm(file: File) {
    closeCropModal();
    if (!onUpload) return;
    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="image-well">
      <button
        type="button"
        className="image-well-container"
        onClick={() => fileInputRef.current?.click()}
        disabled={isLoading}
        aria-label={displaySrc ? "Change photo" : "Add photo"}
      >
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
      </button>

      <div className="image-well-actions">
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

      {pending && (
        <Suspense fallback={null}>
          <ImageCropModal
            imageUrl={pending.url}
            fileName={pending.name}
            onCancel={closeCropModal}
            onConfirm={handleCropConfirm}
          />
        </Suspense>
      )}
    </div>
  );
}
