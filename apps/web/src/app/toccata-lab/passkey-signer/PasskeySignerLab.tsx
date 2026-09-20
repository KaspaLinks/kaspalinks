"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  deriveEscrowSignerPublicIdentity,
  escrowSignerPrfInput,
  type EscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";
import {
  runEscrowPasskeyDryRun,
  type EscrowPasskeyDryRun,
  type EscrowPasskeyDryRunPath,
  type EscrowPasskeyDryRunRole,
  type EscrowPasskeyDryRunSigner,
} from "./escrow-dry-run";

const CREDENTIAL_KEY = "kaspalinks:passkey-lab-credential";
const EXPECTED_FINGERPRINT_KEY = "kaspalinks:passkey-lab-fingerprint";
const BUYER_CONTEXT = {
  escrowId: "passkey-lab-example",
  network: "mainnet",
  role: "buyer",
  signerVersion: 1,
} as const;
const SELLER_CONTEXT = { ...BUYER_CONTEXT, role: "seller" } as const;

const DRY_RUN_PATHS: Array<{
  label: string;
  outcome: string;
  path: EscrowPasskeyDryRunPath;
  phase: "Active" | "Frozen";
  signers: EscrowPasskeyDryRunRole[];
}> = [
  {
    label: "Release",
    outcome: "1 KAS → seller",
    path: "release",
    phase: "Active",
    signers: ["buyer"],
  },
  {
    label: "Freeze",
    outcome: "1 KAS → frozen escrow",
    path: "freeze",
    phase: "Active",
    signers: ["buyer"],
  },
  {
    label: "Refund",
    outcome: "1 KAS → buyer",
    path: "refund-active",
    phase: "Active",
    signers: ["seller"],
  },
  {
    label: "Refund",
    outcome: "0.9998 KAS → buyer",
    path: "refund-frozen",
    phase: "Frozen",
    signers: ["seller"],
  },
  {
    label: "Claim",
    outcome: "1 KAS → seller after deadline",
    path: "claim",
    phase: "Active",
    signers: ["seller"],
  },
  {
    label: "Settle",
    outcome: "0.4 buyer · 0.5998 seller",
    path: "settle",
    phase: "Frozen",
    signers: ["buyer", "seller"],
  },
];

type LabState = "idle" | "running" | "passed" | "mismatch" | "unsupported" | "error";
type DryRunState = "idle" | "running" | "passed" | "error";
type DryRunEntry = {
  message: string;
  result: EscrowPasskeyDryRun | null;
  state: DryRunState;
};
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
  context: EscrowSignerContext,
  credentialId?: Uint8Array<ArrayBuffer>,
): Promise<{ credentialId: string; output: Uint8Array }> {
  const first = await escrowSignerPrfInput(context);
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
  const first = await escrowSignerPrfInput(BUYER_CONTEXT);
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
  const [dryRuns, setDryRuns] = useState<Partial<Record<EscrowPasskeyDryRunPath, DryRunEntry>>>({});

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
      const result = await readPrf(BUYER_CONTEXT, id ? fromBase64Url(id) : undefined);
      prfOutput = result.output;
      const nextIdentity = await deriveEscrowSignerPublicIdentity(prfOutput, BUYER_CONTEXT);
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

  async function signDryRun(path: EscrowPasskeyDryRunPath, roles: EscrowPasskeyDryRunRole[]) {
    if (state !== "passed" || !identity) return;
    setDryRuns((current) => ({
      ...current,
      [path]: {
        message:
          roles.length === 2
            ? "Approve the buyer and seller role prompts."
            : `Approve the ${roles[0]} role prompt.`,
        result: null,
        state: "running",
      },
    }));
    const prfOutputs: Uint8Array[] = [];
    try {
      const signers: Partial<Record<EscrowPasskeyDryRunRole, EscrowPasskeyDryRunSigner>> = {};
      const expectedKeys: Partial<Record<EscrowPasskeyDryRunRole, string>> = {};
      for (const role of roles) {
        const context = role === "buyer" ? BUYER_CONTEXT : SELLER_CONTEXT;
        const result = await readPrf(
          context,
          credentialId ? fromBase64Url(credentialId) : undefined,
        );
        prfOutputs.push(result.output);
        const signerIdentity = await deriveEscrowSignerPublicIdentity(result.output, context);
        if (role === "buyer" && signerIdentity.publicKey !== identity.publicKey) {
          throw new Error("The passkey produced a different buyer signer. Dry-run stopped.");
        }
        expectedKeys[role] = signerIdentity.publicKey;
        signers[role] = { context, prfOutput: result.output };
      }
      const signed = await runEscrowPasskeyDryRun(path, signers);
      for (const role of roles) {
        if (signed.signerPublicKeys[role] !== expectedKeys[role]) {
          throw new Error(`The ${role} passkey was not bound to the signed escrow.`);
        }
      }
      setDryRuns((current) => ({
        ...current,
        [path]: {
          message: "Signed and intent-checked locally. Nothing was broadcast.",
          result: signed,
          state: "passed",
        },
      }));
    } catch (error) {
      setDryRuns((current) => ({
        ...current,
        [path]: {
          message: error instanceof Error ? error.message : "Dry-run signing failed.",
          result: null,
          state: "error",
        },
      }));
    } finally {
      for (const output of prfOutputs) output.fill(0);
    }
  }

  const dryRunBusy = Object.values(dryRuns).some((entry) => entry?.state === "running");

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

      <section className="card passkey-lab-step" aria-labelledby="passkey-dry-run-heading">
        <div className="passkey-lab-number">2</div>
        <div>
          <span className="label">SilverScript V1</span>
          <h2 id="passkey-dry-run-heading">Test every escrow path</h2>
          <p>
            Each card builds and signs an isolated 1 KAS transaction with a fake outpoint. Settle
            asks twice because both roles must sign.
          </p>
          <div className="passkey-lab-paths">
            {DRY_RUN_PATHS.map((item) => {
              const entry = dryRuns[item.path];
              const result = entry?.result;
              return (
                <article
                  className={`passkey-lab-path passkey-lab-dry-result-${entry?.state ?? "idle"}`}
                  key={item.path}
                >
                  <div className="passkey-lab-path-heading">
                    <div>
                      <span>{item.phase}</span>
                      <h3>{item.label}</h3>
                    </div>
                    <strong>
                      {entry?.state === "passed" ? "Passed" : item.signers.join(" + ")}
                    </strong>
                  </div>
                  <p>{item.outcome}</p>
                  <button
                    className="btn"
                    disabled={state !== "passed" || dryRunBusy}
                    onClick={() => void signDryRun(item.path, item.signers)}
                    type="button"
                  >
                    {entry?.state === "running"
                      ? "Signing…"
                      : entry?.state === "passed"
                        ? "Run again"
                        : "Test path"}
                  </button>
                  {entry ? (
                    <div className="passkey-lab-path-result" role="status">
                      <p>{entry.message}</p>
                      {result ? (
                        <details>
                          <summary>Technical result</summary>
                          <dl>
                            <div>
                              <dt>Transaction ID</dt>
                              <dd className="value-mono passkey-lab-key">{result.transactionId}</dd>
                            </div>
                            <div>
                              <dt>Witness</dt>
                              <dd>
                                {result.signatureScriptBytes.toLocaleString()} bytes · SIGHASH_ALL
                              </dd>
                            </div>
                          </dl>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          <p className="notice passkey-lab-funding-warning">
            Fake outpoints only. Any derived address is a test fixture and must never be funded.
          </p>
        </div>
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
