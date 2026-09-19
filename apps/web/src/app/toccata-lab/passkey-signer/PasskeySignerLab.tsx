"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deriveEscrowSignerPublicIdentity,
  escrowSignerPrfInput,
  type EscrowSignerPublicIdentity,
} from "@/lib/escrow-passkey-signer";

const CREDENTIAL_KEY = "kaspalinks:passkey-lab-credential";
const EXPECTED_FINGERPRINT_KEY = "kaspalinks:passkey-lab-fingerprint";
const CONTEXT = {
  escrowId: "passkey-lab-example",
  network: "mainnet",
  role: "buyer",
  signerVersion: 1,
} as const;

type LabState = "idle" | "running" | "passed" | "mismatch" | "unsupported" | "error";
type PrfExtensionResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
type PrfExtensionInput = { prf: { eval: { first: Uint8Array } } };

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toBase64Url(bytes: ArrayBuffer): string {
  const value = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function describeEnvironment(): string {
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/u.test(ua)
    ? "iPhone/iPad"
    : /Android/u.test(ua)
      ? "Android"
      : "Desktop";
  const browser = /CriOS|Chrome/u.test(ua)
    ? "Chrome"
    : /Safari/u.test(ua)
      ? "Safari"
      : /Firefox/u.test(ua)
        ? "Firefox"
        : "Browser";
  const embedded = /(FBAN|FBAV|Instagram|Telegram|Line\/|wv\))/iu.test(ua);
  return `${device} · ${browser}${embedded ? " · embedded browser" : ""}`;
}

function readSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* The lab still works for this page load. */
  }
}

async function readPrf(
  credentialId?: Uint8Array<ArrayBuffer>,
): Promise<{ credentialId: string; output: Uint8Array }> {
  const first = await escrowSignerPrfInput(CONTEXT);
  const publicKey: PublicKeyCredentialRequestOptions = {
    allowCredentials: credentialId ? [{ id: credentialId, type: "public-key" }] : undefined,
    challenge: randomBytes(32),
    timeout: 60_000,
    userVerification: "required",
    extensions: { prf: { eval: { first } } } as AuthenticationExtensionsClientInputs &
      PrfExtensionInput,
  };
  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("No passkey assertion returned.");
  const result = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs &
    PrfExtensionResults;
  const output = result.prf?.results?.first;
  if (!output) throw new Error("This passkey provider did not return a PRF result.");
  return { credentialId: toBase64Url(assertion.rawId), output: new Uint8Array(output) };
}

async function createLabPasskey(): Promise<string> {
  const first = await escrowSignerPrfInput(CONTEXT);
  const publicKey: PublicKeyCredentialCreationOptions = {
    attestation: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    challenge: randomBytes(32),
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },
      { alg: -8, type: "public-key" },
    ],
    rp: { name: "Kaspa Links" },
    timeout: 60_000,
    user: {
      displayName: "Kaspa Links escrow lab",
      id: randomBytes(32),
      name: `escrow-lab-${Date.now()}`,
    },
    extensions: { prf: { eval: { first } } } as AuthenticationExtensionsClientInputs &
      PrfExtensionInput,
  };
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was created.");
  return toBase64Url(credential.rawId);
}

export function PasskeySignerLab() {
  const [environment, setEnvironment] = useState("Detecting browser…");
  const [state, setState] = useState<LabState>("idle");
  const [message, setMessage] = useState("No passkey test has run on this device.");
  const [identity, setIdentity] = useState<EscrowSignerPublicIdentity | null>(null);
  const [credentialId, setCredentialId] = useState("");
  const [expectedFingerprint, setExpectedFingerprint] = useState("");

  useEffect(() => {
    setEnvironment(describeEnvironment());
    setCredentialId(readSession(CREDENTIAL_KEY));
    setExpectedFingerprint(readSession(EXPECTED_FINGERPRINT_KEY));
  }, []);

  const capability = useMemo(() => {
    if (typeof window === "undefined") return { ok: false, label: "Checking…" };
    if (!window.isSecureContext) return { ok: false, label: "HTTPS required" };
    if (!("PublicKeyCredential" in window) || !navigator.credentials)
      return { ok: false, label: "WebAuthn unavailable" };
    if (window.top !== window.self) return { ok: false, label: "Open this page directly" };
    return { ok: true, label: "Ready for passkey test" };
  }, []);

  async function run(create: boolean) {
    if (!capability.ok) {
      setState("unsupported");
      setMessage(capability.label);
      return;
    }
    setState("running");
    setMessage(create ? "Creating a passkey…" : "Requesting the existing passkey…");
    let prfOutput: Uint8Array | null = null;
    try {
      const id = create ? await createLabPasskey() : credentialId;
      const result = await readPrf(id ? fromBase64Url(id) : undefined);
      prfOutput = result.output;
      const nextIdentity = await deriveEscrowSignerPublicIdentity(prfOutput, CONTEXT);
      const baseline = expectedFingerprint || nextIdentity.fingerprint;
      const matches = baseline === nextIdentity.fingerprint;
      writeSession(CREDENTIAL_KEY, result.credentialId);
      writeSession(EXPECTED_FINGERPRINT_KEY, baseline);
      setCredentialId(result.credentialId);
      setExpectedFingerprint(baseline);
      setIdentity(nextIdentity);
      setState(matches ? "passed" : "mismatch");
      setMessage(
        matches
          ? "Stable signer identity confirmed on this device."
          : "The derived signer changed. Do not fund an escrow with this passkey.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Passkey test failed.";
      setState(/PRF|WebAuthn|passkey provider/iu.test(detail) ? "unsupported" : "error");
      setMessage(detail);
    } finally {
      prfOutput?.fill(0);
    }
  }

  return (
    <main className="main-wide escrow-layout passkey-lab">
      <section className="card card-accent passkey-lab-hero">
        <span className="label">Private SilverScript lab</span>
        <h1>Test the Kaspa Links signer</h1>
        <p>
          Create a passkey, derive a public escrow signer locally, then repeat the test. No KAS,
          transaction, private key or PRF output leaves this browser.
        </p>
        <div className="passkey-lab-environment">
          <span>{environment}</span>
          <strong>{capability.label}</strong>
        </div>
      </section>

      <section className="card passkey-lab-step" aria-labelledby="passkey-create-heading">
        <div className="passkey-lab-number">1</div>
        <div>
          <h2 id="passkey-create-heading">Create or select a passkey</h2>
          <p>The system dialog must require Face ID, Touch ID, fingerprint or your device PIN.</p>
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={state === "running" || !capability.ok}
              onClick={() => void run(true)}
              type="button"
            >
              Create test passkey
            </button>
            <button
              className="btn"
              disabled={state === "running" || !capability.ok}
              onClick={() => void run(false)}
              type="button"
            >
              Test existing passkey
            </button>
          </div>
        </div>
      </section>

      <section className={`card passkey-lab-result passkey-lab-result-${state}`} aria-live="polite">
        <span className="label">Current result</span>
        <h2>
          {state === "passed"
            ? "Pass"
            : state === "mismatch"
              ? "Mismatch"
              : state === "running"
                ? "Testing…"
                : "Not verified"}
        </h2>
        <p>{message}</p>
        {identity ? (
          <dl>
            <div>
              <dt>Signer fingerprint</dt>
              <dd className="value-mono">{identity.fingerprint}</dd>
            </div>
            <div>
              <dt>x-only public key</dt>
              <dd className="value-mono passkey-lab-key">{identity.publicKey}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="card" aria-labelledby="passkey-matrix-heading">
        <span className="label">Acceptance gate</span>
        <h2 id="passkey-matrix-heading">Device test matrix</h2>
        <p>
          Run “Test existing passkey” after each change and compare the fingerprint. Every promised
          recovery path must produce exactly the same value.
        </p>
        <div className="passkey-lab-matrix" role="list">
          {[
            ["Same tab", state === "passed" ? "Passed" : "Pending"],
            ["After page reload", "Pending"],
            ["After browser restart", "Pending"],
            ["After device restart", "Pending"],
            ["Second synced Apple/Google device", "Pending"],
            ["Telegram/X link opened in Safari or Chrome", "Pending"],
          ].map(([test, result]) => (
            <div key={test} role="listitem">
              <span>{test}</span>
              <strong>{result}</strong>
            </div>
          ))}
        </div>
        <p className="notice">
          Stop condition: any changed fingerprint, missing PRF result or embedded-browser failure
          blocks real funding for that environment.
        </p>
      </section>

      <div className="row">
        <Link className="btn" href="/escrow">
          Back to escrow studio
        </Link>
      </div>
    </main>
  );
}
