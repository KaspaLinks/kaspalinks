import { describe, expect, it } from "vitest";

import { createToccataLabKeyPair, deriveToccataLabKeyPair } from "./toccata-lab-keys";

describe("createToccataLabKeyPair", () => {
  it("creates browser-side secp256k1 keys with an x-only public key", () => {
    const keyPair = createToccataLabKeyPair();

    expect(keyPair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPair.publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(keyPair.xOnlyPublicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keyPair.publicKey.slice(2)).toBe(keyPair.xOnlyPublicKey);
  });

  it("does not reuse keys between calls", () => {
    const first = createToccataLabKeyPair();
    const second = createToccataLabKeyPair();

    expect(second.privateKey).not.toBe(first.privateKey);
    expect(second.xOnlyPublicKey).not.toBe(first.xOnlyPublicKey);
  });

  it("reconstructs the same public key from a compactly shared private claim code", () => {
    const created = createToccataLabKeyPair();

    expect(deriveToccataLabKeyPair(created.privateKey)).toEqual(created);
    expect(() => deriveToccataLabKeyPair("not-a-private-key")).toThrow("32-byte private key");
  });
});
