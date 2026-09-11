import { createHash } from "node:crypto";
import * as secp from "@noble/secp256k1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  giveawayPrizeV3PlatformPublicKey,
  isGiveawayPrizeV3AttestationConfigured,
  signGiveawayV3EntriesAttestation,
  signGiveawayV3EntropyAttestation,
} from "./giveaway-prize-v3-attest";
import {
  giveawayV3EntriesAttestationDigest,
  giveawayV3EntropyAttestationDigest,
  giveawayV3ParamsHash,
} from "./giveaway-prize-v3-proof";

/**
 * The same test key the Rust engine test uses. Its public key is the one a
 * real Kaspa script accepted there, so asserting it here ties this module to
 * that proof rather than to itself.
 */
const TEST_KEY = createHash("sha256").update("kaspalinks-v3-crosscheck-test-key").digest("hex");
const TEST_PUBLIC_KEY = "1685021ce3cd2ab4914444e087600eefbb6fb54328e79a18fbf3b166450362e5";

const PARAMS = giveawayV3ParamsHash({
  prizeSompi: 100_000_000n,
  drawFeeSompi: 3_000n,
  closesAtDaa: 200_000_000n,
  refundDaa: 200_100_000n,
  creatorPublicKeyHex: "22".repeat(32),
});
const ENTRIES_ROOT = "44".repeat(32);
const BLOCK_HASH = "7a".repeat(32);

function verify(signatureHex: string, digestHex: string): boolean {
  return secp.schnorr.verify(
    Uint8Array.from(Buffer.from(signatureHex, "hex")),
    Uint8Array.from(Buffer.from(digestHex, "hex")),
    Uint8Array.from(Buffer.from(TEST_PUBLIC_KEY, "hex")),
  );
}

describe("giveaway prize v3 attestation", () => {
  beforeEach(() => {
    vi.stubEnv("GIVEAWAY_PLATFORM_SIGNING_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["00".repeat(32), "ff".repeat(32)])("rejects an invalid signing scalar", (key) => {
    vi.stubEnv("GIVEAWAY_PLATFORM_SIGNING_KEY", key);
    expect(isGiveawayPrizeV3AttestationConfigured()).toBe(false);
  });

  it("derives the public key the Kaspa engine accepted", () => {
    expect(giveawayPrizeV3PlatformPublicKey()).toBe(TEST_PUBLIC_KEY);
  });

  it("signs an entry list so the covenant's own digest verifies", () => {
    const signature = signGiveawayV3EntriesAttestation({
      expectedPlatformPublicKeyHex: TEST_PUBLIC_KEY,
      paramsHashHex: PARAMS,
      entriesRootHex: ENTRIES_ROOT,
    });
    const digest = giveawayV3EntriesAttestationDigest({
      paramsHashHex: PARAMS,
      entriesRootHex: ENTRIES_ROOT,
    });
    expect(verify(signature, digest)).toBe(true);
  });

  it("signs an entropy block so the covenant's own digest verifies", () => {
    const signature = signGiveawayV3EntropyAttestation({
      expectedPlatformPublicKeyHex: TEST_PUBLIC_KEY,
      paramsHashHex: PARAMS,
      blockHashHex: BLOCK_HASH,
    });
    const digest = giveawayV3EntropyAttestationDigest({
      paramsHashHex: PARAMS,
      blockHashHex: BLOCK_HASH,
    });
    expect(verify(signature, digest)).toBe(true);
  });

  it("does not let an entry attestation stand in for an entropy attestation", () => {
    const shared = "33".repeat(32);
    const signature = signGiveawayV3EntriesAttestation({
      expectedPlatformPublicKeyHex: TEST_PUBLIC_KEY,
      paramsHashHex: PARAMS,
      entriesRootHex: shared,
    });
    const entropyDigest = giveawayV3EntropyAttestationDigest({
      paramsHashHex: PARAMS,
      blockHashHex: shared,
    });
    expect(verify(signature, entropyDigest)).toBe(false);
  });

  it("does not attest one giveaway's list for another", () => {
    const signature = signGiveawayV3EntriesAttestation({
      expectedPlatformPublicKeyHex: TEST_PUBLIC_KEY,
      paramsHashHex: PARAMS,
      entriesRootHex: ENTRIES_ROOT,
    });
    const otherParams = giveawayV3ParamsHash({
      prizeSompi: 100_000_001n,
      drawFeeSompi: 3_000n,
      closesAtDaa: 200_000_000n,
      refundDaa: 200_100_000n,
      creatorPublicKeyHex: "22".repeat(32),
    });
    const otherDigest = giveawayV3EntriesAttestationDigest({
      paramsHashHex: otherParams,
      entriesRootHex: ENTRIES_ROOT,
    });
    expect(verify(signature, otherDigest)).toBe(false);
  });

  it("reports a missing or malformed key instead of signing with a wrong one", () => {
    vi.stubEnv("GIVEAWAY_PLATFORM_SIGNING_KEY", "");
    expect(isGiveawayPrizeV3AttestationConfigured()).toBe(false);
    expect(() => giveawayPrizeV3PlatformPublicKey()).toThrow(/is not set/);

    vi.stubEnv("GIVEAWAY_PLATFORM_SIGNING_KEY", "not-a-key");
    expect(isGiveawayPrizeV3AttestationConfigured()).toBe(false);
    expect(() => giveawayPrizeV3PlatformPublicKey()).toThrow(/32-byte hex/);
  });

  it("reports a configured key", () => {
    expect(isGiveawayPrizeV3AttestationConfigured()).toBe(true);
  });
  it("refuses attestations after an incompatible key rotation", () => {
    expect(() =>
      signGiveawayV3EntriesAttestation({
        expectedPlatformPublicKeyHex: "ff".repeat(32),
        paramsHashHex: PARAMS,
        entriesRootHex: ENTRIES_ROOT,
      }),
    ).toThrow(/does not match/);
  });
});
