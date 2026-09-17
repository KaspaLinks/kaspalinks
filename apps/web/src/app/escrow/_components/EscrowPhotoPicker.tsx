"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { ImageIcon } from "./EscrowIcons";

type Photo = { id: string; name: string; url: string };

/** Local-only photo previews. Files never leave the browser in the prototype. */
export function EscrowPhotoPicker({
  help,
  id,
  label,
  maxPhotos = 4,
}: {
  help: string;
  id: string;
  label: string;
  maxPhotos?: number;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  photosRef.current = photos;

  useEffect(() => {
    return () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    };
  }, []);

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    const room = maxPhotos - photos.length;
    const added = files.slice(0, Math.max(room, 0)).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setPhotos((current) => [...current, ...added]);
    event.target.value = "";
  }

  function removePhoto(photo: Photo) {
    URL.revokeObjectURL(photo.url);
    setPhotos((current) => current.filter((entry) => entry.id !== photo.id));
  }

  const full = photos.length >= maxPhotos;

  return (
    <div className="form-field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div aria-labelledby={`${id}-label`} className="escrow-photo-grid" role="group">
        {photos.map((photo, index) => (
          <figure className="escrow-photo-tile" key={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimizable asset */}
            <img alt={`Photo ${index + 1}: ${photo.name}`} src={photo.url} />
            <button
              aria-label={`Remove photo ${index + 1}`}
              className="escrow-photo-remove"
              onClick={() => removePhoto(photo)}
              type="button"
            >
              ×
            </button>
          </figure>
        ))}
        {full ? null : (
          <label className="escrow-photo-add" htmlFor={id}>
            <ImageIcon />
            <span>Add photo</span>
            <input
              accept="image/*"
              className="escrow-sr-only"
              id={id}
              multiple
              onChange={addPhotos}
              type="file"
            />
          </label>
        )}
      </div>
      <p className="form-field-help">
        {help} Up to {maxPhotos} photos.
      </p>
    </div>
  );
}
