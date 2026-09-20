import { escrowSignerPrfInput, type EscrowSignerContext } from "./escrow-passkey-signer";

type PrfExtensionResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
type PrfExtensionInput = { prf: { eval: { first: Uint8Array } } };

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function encodeCredentialId(bytes: ArrayBuffer): string {
  const value = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCredentialId(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function createEscrowPasskey(
  context: EscrowSignerContext,
  label: string,
): Promise<string> {
  const first = await escrowSignerPrfInput(context);
  const publicKey: PublicKeyCredentialCreationOptions = {
    attestation: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    challenge: randomBytes(32),
    extensions: { prf: { eval: { first } } } as AuthenticationExtensionsClientInputs &
      PrfExtensionInput,
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },
      { alg: -8, type: "public-key" },
    ],
    rp: { name: "Kaspa Links" },
    timeout: 60_000,
    user: {
      displayName: label.slice(0, 64),
      id: randomBytes(32),
      name: `escrow-${Date.now()}`,
    },
  };
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was created.");
  return encodeCredentialId(credential.rawId);
}

export async function readEscrowPasskeyPrf(
  context: EscrowSignerContext,
  credentialId?: string,
): Promise<{ credentialId: string; output: Uint8Array }> {
  const first = await escrowSignerPrfInput(context);
  const publicKey: PublicKeyCredentialRequestOptions = {
    allowCredentials: credentialId
      ? [{ id: decodeCredentialId(credentialId), type: "public-key" }]
      : undefined,
    challenge: randomBytes(32),
    extensions: { prf: { eval: { first } } } as AuthenticationExtensionsClientInputs &
      PrfExtensionInput,
    timeout: 60_000,
    userVerification: "required",
  };
  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("No passkey assertion returned.");
  const result = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs &
    PrfExtensionResults;
  const output = result.prf?.results?.first;
  if (!output) throw new Error("This passkey provider did not return a PRF result.");
  return { credentialId: encodeCredentialId(assertion.rawId), output: new Uint8Array(output) };
}

export function escrowPasskeySupported(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "PublicKeyCredential" in window &&
    navigator.credentials &&
    window.top === window.self,
  );
}
