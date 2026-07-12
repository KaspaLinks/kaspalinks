import { describe, expect, it } from "vitest";

import { validateKaspaAddress } from "./address";

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
