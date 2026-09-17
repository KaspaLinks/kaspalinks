"use client";

import { useState, type FormEvent } from "react";

const CARRIERS = ["DHL", "DPD", "Hermes", "GLS", "UPS", "Deutsche Post", "Other"] as const;

export function EscrowShipmentForm({
  onSubmit,
}: {
  onSubmit: (carrier: string, trackingNumber: string) => void;
}) {
  const [carrier, setCarrier] = useState<string>(CARRIERS[0]);
  const [trackingNumber, setTrackingNumber] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(carrier, trackingNumber.trim());
  }

  return (
    <form className="escrow-shipment-form" onSubmit={submit}>
      <div className="form-field">
        <label className="label" htmlFor="escrow-carrier">
          Carrier
        </label>
        <select
          id="escrow-carrier"
          onChange={(event) => setCarrier(event.target.value)}
          value={carrier}
        >
          {CARRIERS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label className="label" htmlFor="escrow-tracking">
          Tracking number <span className="form-field-meta">— optional</span>
        </label>
        <input
          autoComplete="off"
          id="escrow-tracking"
          maxLength={64}
          onChange={(event) => setTrackingNumber(event.target.value)}
          placeholder="00340434161234567890"
          spellCheck={false}
          type="text"
          value={trackingNumber}
        />
        <p className="form-field-help">
          Shown to the buyer on this page. KaspaLinks does not contact the carrier.
        </p>
      </div>
      <button className="btn btn-primary btn-block btn-pay" type="submit">
        Mark as shipped
      </button>
    </form>
  );
}
