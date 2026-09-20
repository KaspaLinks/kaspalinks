import { describe, expect, it } from "vitest";
import {
  deriveEscrowSignerPublicIdentity,
  escrowSignerPrfInput,
  serializeEscrowSignerContext,
  withEscrowSignerSecret,
} from "./escrow-passkey-signer";

const context = {
  escrowId: "passkey-lab-example",
  network: "mainnet",
  role: "buyer",
  signerVersion: 1,
} as const;

describe("escrow passkey signer derivation", () => {
  it("domain-separates the PRF input", async () => {
    const buyer = await escrowSignerPrfInput(context);
    const seller = await escrowSignerPrfInput({ ...context, role: "seller" });
    expect(buyer).toHaveLength(32);
    expect(Buffer.from(buyer).equals(Buffer.from(seller))).toBe(false);
    expect(serializeEscrowSignerContext(context)).toBe(
      "Kaspa Links Escrow Signer v1/mainnet/passkey-lab-example/buyer/v1",
    );
  });

  it("derives a stable x-only key without returning secret material", async () => {
    const prf = new Uint8Array(32).fill(7);
    const first = await deriveEscrowSignerPublicIdentity(prf, context);
    const second = await deriveEscrowSignerPublicIdentity(prf, context);
    expect(first).toEqual(second);
    expect(first.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(Object.keys(first).sort()).toEqual(["fingerprint", "publicKey"]);
  });

  it("rejects malformed inputs and separates roles", async () => {
    await expect(deriveEscrowSignerPublicIdentity(new Uint8Array(31), context)).rejects.toThrow(
      "Invalid passkey PRF output",
    );
    const prf = new Uint8Array(32).fill(9);
    const buyer = await deriveEscrowSignerPublicIdentity(prf, context);
    const seller = await deriveEscrowSignerPublicIdentity(prf, { ...context, role: "seller" });
    expect(buyer.publicKey).not.toBe(seller.publicKey);
    expect(() => serializeEscrowSignerContext({ ...context, escrowId: "bad/id" })).toThrow();
  });

  it("wipes the temporary secret after the caller finishes", async () => {
    let observed: Uint8Array | undefined;
    const result = await withEscrowSignerSecret(new Uint8Array(32).fill(3), context, (secret) => {
      observed = secret;
      expect(secret.some((byte) => byte !== 0)).toBe(true);
      return "used";
    });
    expect(result).toBe("used");
    expect(observed).toEqual(new Uint8Array(32));
  });
});
