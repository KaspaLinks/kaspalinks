import { createHash, createHmac } from "node:crypto";

import * as secp from "@noble/secp256k1";

import {
  giveawayV3EntriesAttestationDigest,
  giveawayV3EntropyAttestationDigest,
} from "./giveaway-prize-v3-proof";

/**
 * Platform attestations for the prize covenant (protocol v3).
 *
 * The covenant will not freeze an entry list or run a draw without a signature
 * from this key. Two consequences worth stating plainly:
 *
 * - Losing the key strands every live giveaway. Nothing can be frozen or drawn
 *   any more, and each prize waits for its refund deadline.
 * - Leaking the key lets the holder attest a forged entry list, which is the
 *   exact redirection the covenant exists to prevent.
 *
 * The key is read from the environment on every call rather than captured at
 * module load, so calls use the current process environment and a
 * missing key surfaces at the call site.
 *
 * Server only: the `node:crypto` import fails to bundle for the browser, which
 * is the guard against this module reaching a client component.
 */

const SIGNING_KEY_ENV = "GIVEAWAY_PLATFORM_SIGNING_KEY";

/**
 * noble v3 deliberately ships without a hash implementation and expects the
 * caller to supply one. It invokes these with a fixed argument count, so the
 * unused slots arrive as `undefined` and must be skipped rather than passed
 * to `createHash`, which would throw.
 */
let hashesInstalled = false;
function installHashes(): void {
  if (hashesInstalled) return;
  secp.hashes.sha256 = (...parts: (Uint8Array | undefined)[]) => {
    const hash = createHash("sha256");
    for (const part of parts) if (part) hash.update(Buffer.from(part));
    return Uint8Array.from(hash.digest());
  };
  secp.hashes.hmacSha256 = (key: Uint8Array, ...parts: (Uint8Array | undefined)[]) => {
    const hmac = createHmac("sha256", Buffer.from(key));
    for (const part of parts) if (part) hmac.update(Buffer.from(part));
    return Uint8Array.from(hmac.digest());
  };
  hashesInstalled = true;
}

function readSigningKey(): Uint8Array {
  const raw = process.env[SIGNING_KEY_ENV]?.trim().toLowerCase() ?? "";
  if (!raw) {
    throw new Error(
      `${SIGNING_KEY_ENV} is not set. The prize covenant cannot be frozen or drawn without it.`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new Error(`${SIGNING_KEY_ENV} must be a 32-byte hex private key.`);
  }
  return Uint8Array.from(Buffer.from(raw, "hex"));
}

/** True when the platform can attest at all. Lets callers report a clear state. */
export function isGiveawayPrizeV3AttestationConfigured(): boolean {
  try {
    secp.schnorr.getPublicKey(readSigningKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * The x-only public key baked into every prize covenant script. Changing it
 * changes every future giveaway address, so a rotation has to keep the old key
 * until the last giveaway created under it has settled.
 */
export function giveawayPrizeV3PlatformPublicKey(): string {
  installHashes();
  return Buffer.from(secp.schnorr.getPublicKey(readSigningKey())).toString("hex");
}

function sign(digestHex: string, expectedPlatformPublicKeyHex: string): string {
  if (giveawayPrizeV3PlatformPublicKey() !== expectedPlatformPublicKeyHex.toLowerCase()) {
    throw new Error("The configured platform key does not match this covenant.");
  }
  installHashes();
  const digest = Uint8Array.from(Buffer.from(digestHex, "hex"));
  return Buffer.from(secp.schnorr.sign(digest, readSigningKey())).toString("hex");
}

/**
 * Attest that this entry list is the one the platform collected for this
 * giveaway. The creator does not sign this: a creator signature would let them
 * freeze a list holding only their own addresses.
 */
export function signGiveawayV3EntriesAttestation(params: {
  expectedPlatformPublicKeyHex: string;
  paramsHashHex: string;
  entriesRootHex: string;
}): string {
  return sign(giveawayV3EntriesAttestationDigest(params), params.expectedPlatformPublicKeyHex);
}

/**
 * Attest the entropy block for this draw.
 *
 * The script verifies the block is in the selected chain but cannot read its
 * blue score, so without this any submitter could pick among every block
 * inside the finality window and grind themselves a win. The target height is
 * published ahead of the draw, which makes a deviation provable by anyone.
 */
export function signGiveawayV3EntropyAttestation(params: {
  expectedPlatformPublicKeyHex: string;
  paramsHashHex: string;
  blockHashHex: string;
}): string {
  return sign(giveawayV3EntropyAttestationDigest(params), params.expectedPlatformPublicKeyHex);
}
