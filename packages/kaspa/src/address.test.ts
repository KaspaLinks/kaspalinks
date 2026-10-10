import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";

import { kaspaAddressFromScriptPublicKeyHex, validateKaspaAddress } from "./address";

const VALID_MAINNET_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const VALID_TESTNET_ADDRESS =
  "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

describe("validateKaspaAddress", () => {
  it("accepts real mainnet and testnet addresses validated by the Kaspa WASM SDK", () => {
    expect(validateKaspaAddress(VALID_MAINNET_ADDRESS)).toEqual({
      address: VALID_MAINNET_ADDRESS,
      network: "mainnet",
      valid: true,
    });
    expect(validateKaspaAddress(VALID_TESTNET_ADDRESS)).toEqual({
      address: VALID_TESTNET_ADDRESS,
      network: "testnet",
      valid: true,
    });
  });

  it("rejects empty values, whitespace, wrong prefixes, unsafe characters, and bad checksums", () => {
    for (const address of [
      "",
      ` ${VALID_MAINNET_ADDRESS}`,
      `${VALID_MAINNET_ADDRESS} `,
      "bitcoin:qpzry9x8gf2tvdw0s3jn54khce6mua7l",
      "kaspa:hallo",
      "kaspa:qpzry9x8",
      "kaspa:QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L",
      "kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7l!",
      "kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l",
    ]) {
      expect(validateKaspaAddress(address).valid).toBe(false);
    }
  });
});

describe("kaspaAddressFromScriptPublicKeyHex", () => {
  it("restores a canonical mainnet payout address", () => {
    const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
    const address = new sdk.PrivateKey("42".repeat(32))
      .toPublicKey()
      .toAddress("mainnet")
      .toString();
    const script = sdk.payToAddressScript(address).toJSON() as { version: number; script: string };

    expect(
      kaspaAddressFromScriptPublicKeyHex(
        script.version.toString(16).padStart(4, "0") + script.script,
      ),
    ).toBe(address);
  });

  it("restores a canonical testnet-10 payout address", () => {
    const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
    const address = new sdk.PrivateKey("43".repeat(32))
      .toPublicKey()
      .toAddress("testnet-10")
      .toString();
    const script = sdk.payToAddressScript(address).toJSON() as { version: number; script: string };

    expect(
      kaspaAddressFromScriptPublicKeyHex(
        script.version.toString(16).padStart(4, "0") + script.script,
        "testnet-10",
      ),
    ).toBe(address);
  });

  it("rejects malformed script serialization", () => {
    expect(() => kaspaAddressFromScriptPublicKeyHex("51")).toThrow(/version prefix/u);
  });
});
