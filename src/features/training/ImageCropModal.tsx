import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { useFocusTrap } from "../../shared/hooks/useFocusTrap";

export interface ImageCropModalProps {
  imageUrl: string;
  fileName: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

async function getCroppedFile(imageUrl: string, crop: Area, fileName: string): Promise<File> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load failed"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("crop failed"))), "image/png");
  });
  const baseName = fileName.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${baseName}.png`, { type: "image/png" });
}

export function ImageCropModal({ imageUrl, fileName, onCancel, onConfirm }: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useFocusTrap(sheetRef, onCancel);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  async function handleSave() {
    if (!croppedArea) return;
    setSaving(true);
    try {
      const file = await getCroppedFile(imageUrl, croppedArea, fileName);
      onConfirm(file);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <>
      <div className="settings-backdrop" onClick={onCancel} />
      <div
        ref={sheetRef}
        className="settings-sheet image-crop-sheet"
        role="dialog"
        aria-modal
        aria-label="Crop photo"
      >
        <div className="settings-sheet-header">
          <span className="settings-sheet-title">Crop photo</span>
          <button className="settings-sheet-close" onClick={onCancel} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="image-crop-area">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="image-crop-controls">
          <input
            type="range"
            className="image-crop-zoom"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
        </div>

        <div className="edit-exercise-actions image-crop-actions">
          <button
            type="button"
            className="btn-log-primary"
            onClick={handleSave}
            disabled={saving || !croppedArea}
          >
            {saving ? "Cropping…" : "Use photo"}
          </button>
          <button type="button" className="btn-log-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
