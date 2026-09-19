"use client";

import { useState, type FormEvent } from "react";

import { EscrowPhotoPicker } from "../_components/EscrowPhotoPicker";
import { ESCROW_FREEZE_REASONS } from "../_lib/escrow-status";
import type { EscrowFreezeReason } from "../_lib/escrow-types";

const NOTE_MAX_LENGTH = 500;

export function EscrowFreezeForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (reason: EscrowFreezeReason, note: string) => void;
}) {
  const [reason, setReason] = useState<EscrowFreezeReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<null | string>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason) {
      setError("Choose what went wrong.");
      return;
    }
    onSubmit(reason, note.trim());
  }

  return (
    <form className="escrow-freeze-form" noValidate onSubmit={submit}>
      <fieldset
        aria-describedby={error ? "escrow-freeze-error" : undefined}
        className="form-field escrow-fieldset"
      >
        <legend className="label">What went wrong?</legend>
        <div className="escrow-radio-list">
          {ESCROW_FREEZE_REASONS.map((option) => (
            <label className="escrow-radio" key={option.value}>
              <input
                checked={reason === option.value}
                name="escrow-freeze-reason"
                onChange={() => {
                  setReason(option.value);
                  setError(null);
                }}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="form-field">
        <label className="label" htmlFor="escrow-freeze-note">
          Describe the problem <span className="form-field-meta">— the seller sees this</span>
        </label>
        <textarea
          id="escrow-freeze-note"
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What arrived, and how does it differ from the description?"
          value={note}
        />
      </div>

      <EscrowPhotoPicker
        help="Optional. In this prototype, photos stay on your device."
        id="escrow-freeze-photos"
        label="Photos"
        maxPhotos={3}
      />

      <p className="notice notice-warn">
        Freezing blocks the seller claim. You can both sign a split, or the seller can refund you
        alone. Without either, funds may remain locked indefinitely.
      </p>

      {error ? (
        <p className="error-text" id="escrow-freeze-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="row-stack">
        <button className="btn btn-danger btn-block" type="submit">
          Freeze escrow
        </button>
        <button className="btn btn-block" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}
