import { getPublicKey, utils } from "@noble/secp256k1";

const DOMAIN = "Kaspa Links Escrow Signer v1";
const encoder = new TextEncoder();

export type EscrowSignerContext = {
  escrowId: string;
  network: "mainnet" | "testnet-10";
  role: "buyer" | "seller";
  signerVersion: 1;
};

export type EscrowSignerPublicIdentity = {
  fingerprint: string;
  publicKey: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function serializeEscrowSignerContext(context: EscrowSignerContext): string {
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(context.escrowId)) {
    throw new Error("Invalid escrow signer context.");
  }
  return [
    DOMAIN,
    context.network,
    context.escrowId,
    context.role,
    `v${context.signerVersion}`,
  ].join("/");
}

export async function escrowSignerPrfInput(context: EscrowSignerContext): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(serializeEscrowSignerContext(context)),
  );
  return new Uint8Array(digest);
}

/**
 * Turns a WebAuthn PRF result into the x-only secp256k1 public key committed by
 * Escrow V1. The secret scalar never leaves this function and is wiped after use.
 */
export async function deriveEscrowSignerPublicIdentity(
  prfOutput: Uint8Array,
  context: EscrowSignerContext,
): Promise<EscrowSignerPublicIdentity> {
  if (prfOutput.length !== 32) throw new Error("Invalid passkey PRF output.");

  const contextBytes = encoder.encode(serializeEscrowSignerContext(context));
  const prfKeyBytes = Uint8Array.from(prfOutput);
  const keyMaterial = await crypto.subtle.importKey("raw", prfKeyBytes, "HKDF", false, [
    "deriveBits",
  ]);
  prfKeyBytes.fill(0);
  let candidate: Uint8Array | null = null;

  try {
    for (let counter = 0; counter < 256; counter += 1) {
      const info = new Uint8Array(contextBytes.length + 1);
      info.set(contextBytes);
      info[info.length - 1] = counter;
      const bits = await crypto.subtle.deriveBits(
        { hash: "SHA-256", info, name: "HKDF", salt: encoder.encode(DOMAIN) },
        keyMaterial,
        256,
      );
      candidate = new Uint8Array(bits);
      if (!utils.isValidSecretKey(candidate)) {
        candidate.fill(0);
        candidate = null;
        continue;
      }

      const compressed = getPublicKey(candidate, true);
      const publicKey = new Uint8Array(compressed).slice(1);
      const fingerprintDigest = await crypto.subtle.digest("SHA-256", publicKey);
      const fingerprint = bytesToHex(new Uint8Array(fingerprintDigest).slice(0, 6));
      return {
        fingerprint: fingerprint.match(/.{1,4}/g)?.join("-") ?? fingerprint,
        publicKey: bytesToHex(publicKey),
      };
    }
    throw new Error("Could not derive a valid escrow signing key.");
  } finally {
    candidate?.fill(0);
  }
}
