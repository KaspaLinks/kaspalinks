"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { CreatorSignInGate } from "../../CreatorSignInGate";
import { EscrowAmountBreakdown } from "../_components/EscrowAmountBreakdown";
import { EscrowKasAmount } from "../_components/EscrowKasAmount";
import { EscrowPhotoPicker } from "../_components/EscrowPhotoPicker";
import { EscrowPrototypeNotice } from "../_components/EscrowPrototypeNotice";
import {
  ESCROW_DESCRIPTION_MAX_LENGTH,
  ESCROW_RELEASE_WINDOW_OPTIONS,
  ESCROW_TITLE_MAX_LENGTH,
  validateEscrowDraft,
  type EscrowDraftField,
  type EscrowDraftInput,
} from "../_lib/escrow-draft";
import { ESCROW_CONDITION_LABEL } from "../_lib/escrow-status";
import type { EscrowCondition } from "../_lib/escrow-types";
import { useCreatorSession } from "../_lib/use-creator-session";

const EMPTY_DRAFT: EscrowDraftInput = {
  condition: "",
  description: "",
  payoutAddress: "",
  priceKas: "",
  releaseWindowDays: 14,
  shippingKas: "",
  title: "",
};

const CONDITION_ORDER: ReadonlyArray<EscrowCondition> = ["new", "like_new", "used", "for_parts"];

const HELP_IDS: Partial<Record<EscrowDraftField, string>> = {
  description: "escrow-description-help",
  payoutAddress: "escrow-payoutAddress-help",
  priceKas: "escrow-price-help",
  shippingKas: "escrow-price-help",
};

// The example deal a freshly created link continues into, since the prototype saves nothing.
const EXAMPLE_NEW_DEAL_ID = "community-hoodie";

function FieldError({ field, message }: { field: EscrowDraftField; message?: string }) {
  if (!message) return null;
  return (
    <p className="form-field-help form-field-warn" id={`escrow-${field}-error`}>
      {message}
    </p>
  );
}

export function NewEscrowClient() {
  const session = useCreatorSession();
  const [draft, setDraft] = useState<EscrowDraftInput>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<Partial<Record<EscrowDraftField, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [created, setCreated] = useState(false);

  const validation = useMemo(() => validateEscrowDraft(draft), [draft]);
  const { amounts } = validation;

  function update<K extends keyof EscrowDraftInput>(key: K, value: EscrowDraftInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function touch(field: EscrowDraftField) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  function errorFor(field: EscrowDraftField): string | undefined {
    return submitAttempted || touched[field] ? validation.errors[field] : undefined;
  }

  function fieldProps(field: EscrowDraftField) {
    const error = errorFor(field);
    return {
      "aria-describedby": error ? `escrow-${field}-error` : HELP_IDS[field],
      "aria-invalid": error ? true : undefined,
      onBlur: () => touch(field),
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (validation.ok) {
      setCreated(true);
      window.scrollTo({ top: 0 });
    }
  }

  if (!session.hydrated) {
    return (
      <main className="main-wide escrow-layout">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  if (!session.signedIn) {
    return (
      <main className="main-wide escrow-layout">
        <CreatorSignInGate
          description="Escrow links use your existing KaspaLinks profile. No extra account and no email."
          label="Escrow link"
          nextPath="/escrow/new"
          title="Sign in to create an escrow link"
        />
      </main>
    );
  }

  if (created && amounts) {
    return (
      <main className="main-wide escrow-layout">
        <EscrowPrototypeNotice />
        <section aria-live="polite" className="card card-accent escrow-created">
          <span className="label">Escrow link ready</span>
          <h1>{draft.title.trim()}</h1>
          <p>V1 requires no seller deposit. The next step is buyer funding.</p>
          <p className="muted">
            This prototype does not save links. Continue with an example deal waiting at the same
            step.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href={`/escrow/${EXAMPLE_NEW_DEAL_ID}`}>
              Continue with example
            </Link>
            <button className="btn" onClick={() => setCreated(false)} type="button">
              Edit details
            </button>
          </div>
        </section>
      </main>
    );
  }

  const showErrorSummary = submitAttempted && !validation.ok;

  return (
    <main className="main-wide escrow-layout">
      <EscrowPrototypeNotice />

      <section className="card card-accent">
        <span className="label">New escrow link</span>
        <h1 style={{ marginBottom: 6 }}>Sell with Kaspa escrow</h1>
        <p className="muted" style={{ margin: 0 }}>
          Describe the deal you agreed on. The buyer pays into a Kaspa covenant, never into
          KaspaLinks.
        </p>
      </section>

      <div className="new-link-grid">
        <section aria-label="Preview" aria-live="polite" className="card preview-card">
          <span className="preview-card-eyebrow">Buyer preview</span>
          <div className="preview-card-stage">
            <span className="link-type-pill">Escrow link</span>
            <h3 className="preview-card-title">
              {draft.title.trim() || <span className="preview-card-placeholder">Item title</span>}
            </h3>
            {draft.condition ? (
              <p className="escrow-condition">{ESCROW_CONDITION_LABEL[draft.condition]}</p>
            ) : null}
            <p className="preview-card-description escrow-preview-description">
              {draft.description.trim() || (
                <span className="preview-card-placeholder">Your description appears here.</span>
              )}
            </p>
            <div className="preview-card-divider" />
            {amounts ? (
              <>
                <EscrowKasAmount label="Price" sompi={amounts.priceSompi} />
                <EscrowAmountBreakdown amounts={amounts} role="seller" />
              </>
            ) : (
              <p className="preview-card-placeholder">Set a price to see what each side locks.</p>
            )}
            <p className="escrow-preview-window">
              Release window: {draft.releaseWindowDays} days after payment
            </p>
          </div>
        </section>

        <form className="new-link-form" id="new-escrow-form" noValidate onSubmit={submit}>
          <section className="card">
            <h2 className="form-section-heading">The item</h2>

            <div className="form-field">
              <label className="label" htmlFor="escrow-title">
                Title
              </label>
              <input
                id="escrow-title"
                maxLength={ESCROW_TITLE_MAX_LENGTH}
                onChange={(event) => update("title", event.target.value)}
                placeholder="Smartphone Pro 256 GB"
                type="text"
                value={draft.title}
                {...fieldProps("title")}
              />
              <FieldError field="title" message={errorFor("title")} />
            </div>

            <fieldset
              aria-describedby={errorFor("condition") ? "escrow-condition-error" : undefined}
              className="form-field escrow-fieldset"
            >
              <legend className="label">Condition</legend>
              <div className="type-segmented">
                {CONDITION_ORDER.map((value) => (
                  <label
                    className={`type-segment escrow-choice${
                      draft.condition === value ? " type-segment-active" : ""
                    }`}
                    key={value}
                  >
                    <input
                      checked={draft.condition === value}
                      className="escrow-sr-only"
                      name="escrow-condition"
                      onChange={() => {
                        update("condition", value);
                        touch("condition");
                      }}
                      type="radio"
                      value={value}
                    />
                    {ESCROW_CONDITION_LABEL[value]}
                  </label>
                ))}
              </div>
              <FieldError field="condition" message={errorFor("condition")} />
            </fieldset>

            <div className="form-field">
              <label className="label" htmlFor="escrow-description">
                Description{" "}
                <span className="form-field-meta">
                  — {draft.description.length}/{ESCROW_DESCRIPTION_MAX_LENGTH}
                </span>
              </label>
              <textarea
                id="escrow-description"
                maxLength={ESCROW_DESCRIPTION_MAX_LENGTH}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Model, storage, condition details, what is included."
                value={draft.description}
                {...fieldProps("description")}
              />
              {errorFor("description") ? (
                <FieldError field="description" message={errorFor("description")} />
              ) : (
                <p className="form-field-help" id="escrow-description-help">
                  Be specific. If you ever disagree, this is what you both refer to.
                </p>
              )}
            </div>
          </section>

          <section className="card">
            <h2 className="form-section-heading">Photos</h2>
            <EscrowPhotoPicker
              help="Optional. In this prototype, photos stay on your device."
              id="escrow-photos"
              label="Item photos"
            />
          </section>

          <section className="card">
            <h2 className="form-section-heading">Price</h2>
            <div className="grid-two">
              <div className="form-field">
                <label className="label" htmlFor="escrow-price">
                  Price (KAS)
                </label>
                <input
                  id="escrow-price"
                  inputMode="decimal"
                  onChange={(event) => update("priceKas", event.target.value)}
                  placeholder="4500"
                  type="text"
                  value={draft.priceKas}
                  {...fieldProps("priceKas")}
                />
                <FieldError field="priceKas" message={errorFor("priceKas")} />
              </div>
              <div className="form-field">
                <label className="label" htmlFor="escrow-shipping">
                  Shipping (KAS) <span className="form-field-meta">— optional</span>
                </label>
                <input
                  id="escrow-shipping"
                  inputMode="decimal"
                  onChange={(event) => update("shippingKas", event.target.value)}
                  placeholder="0"
                  type="text"
                  value={draft.shippingKas}
                  {...fieldProps("shippingKas")}
                />
                <FieldError field="shippingKas" message={errorFor("shippingKas")} />
              </div>
            </div>
            <p className="form-field-help" id="escrow-price-help">
              KAS is the amount that counts. The USD value in the preview is only an estimate.
            </p>
          </section>

          <section className="card">
            <h2 className="form-section-heading">Release window</h2>

            <p className="form-field-help">
              V1 has no deposits. The buyer funds the payment and a network-fee reserve.
            </p>

            <fieldset className="form-field escrow-fieldset">
              <legend className="label">Release window</legend>
              <div className="type-segmented">
                {ESCROW_RELEASE_WINDOW_OPTIONS.map((days) => (
                  <label
                    className={`type-segment escrow-choice${
                      draft.releaseWindowDays === days ? " type-segment-active" : ""
                    }`}
                    key={days}
                  >
                    <input
                      checked={draft.releaseWindowDays === days}
                      className="escrow-sr-only"
                      name="escrow-window"
                      onChange={() => update("releaseWindowDays", days)}
                      type="radio"
                      value={days}
                    />
                    {days} days
                  </label>
                ))}
              </div>
              <p className="form-field-help">
                Counted from payment. The buyer can freeze the escrow until then. If they do
                nothing, you can claim the payment. Leave enough time for shipping.
              </p>
            </fieldset>
          </section>

          <section className="card">
            <h2 className="form-section-heading">Payout</h2>
            <div className="form-field">
              <label className="label" htmlFor="escrow-payout">
                Your payout address
              </label>
              <input
                autoComplete="off"
                id="escrow-payout"
                onChange={(event) => update("payoutAddress", event.target.value)}
                placeholder="kaspa:..."
                spellCheck={false}
                type="text"
                value={draft.payoutAddress}
                {...fieldProps("payoutAddress")}
              />
              {errorFor("payoutAddress") ? (
                <FieldError field="payoutAddress" message={errorFor("payoutAddress")} />
              ) : (
                <p className="form-field-help" id="escrow-payoutAddress-help">
                  Paste the address from your own wallet. Your wallet signs every step; KaspaLinks
                  never sees your keys.
                </p>
              )}
            </div>
          </section>
        </form>

        <div className="new-link-actions">
          {showErrorSummary ? (
            <p className="error-text escrow-error-summary" role="alert">
              Check the highlighted fields before creating the link.
            </p>
          ) : null}
          <button
            className="btn btn-primary btn-block btn-pay"
            form="new-escrow-form"
            type="submit"
          >
            Create escrow link
          </button>
        </div>
      </div>

      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/escrow">← Back to escrow links</Link>
        </p>
      </section>
    </main>
  );
}
