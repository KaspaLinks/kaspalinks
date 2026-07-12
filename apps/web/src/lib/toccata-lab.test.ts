import { describe, expect, it } from "vitest";

import {
  createToccataLabQrUri,
  createToccataLabIntent,
  readClaimableSpendMode,
  TOCCATA_LAB_DEFAULT_LABEL,
  validateRegisteredClaimableMetadata,
} from "./toccata-lab";

const MAINNET_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const TESTNET_ADDRESS = "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";
const CLAIM_PUBLIC_KEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
const REFUND_PUBLIC_KEY = "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27";
const CLAIMABLE_ADDRESS = "kaspa:ppkr0dzfr3ptks6w0238uzqrqr98h07a3rrplzlwdmau3hapzjma6qe42a2vh";
const CLAIMABLE_SCRIPT =
  "63204f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac67b5040065cd1da26920466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27ac68";

describe("Claimable link helpers", () => {
  it("creates a mainnet claimable-link funding intent", () => {
    const intent = createToccataLabIntent({
      amountKas: "1",
      label: "",
      message: "Mini test",
      recipientAddress: MAINNET_ADDRESS,
    });

    expect(intent).toMatchObject({
      amountKas: "1",
      amountSompi: "100000000",
      label: TOCCATA_LAB_DEFAULT_LABEL,
      message: "Mini test",
      network: "mainnet",
      recipientAddress: MAINNET_ADDRESS,
      walletLaunchUri: `${MAINNET_ADDRESS}?amount=1`,
    });
    expect(intent.sdk.ready).toBe(true);
    expect(intent.sdk.version).toBe("2.0.1");
    expect(intent.uri).toBe(
      `${MAINNET_ADDRESS}?amount=1&label=Kaspa%20Links%20claimable&message=Mini%20test`,
    );
  });

  it("rejects testnet addresses for mainnet claimable links", () => {
    expect(() =>
      createToccataLabIntent({
        amountKas: "1",
        recipientAddress: TESTNET_ADDRESS,
      }),
    ).toThrow("Claimable links only accept mainnet kaspa: addresses.");
  });

  it("does not impose an artificial claimable-link maximum", () => {
    const intent = createToccataLabIntent({
      amountKas: "25.12345678",
      recipientAddress: MAINNET_ADDRESS,
    });

    expect(intent.amountKas).toBe("25.12345678");
    expect(intent.amountSompi).toBe("2512345678");
    expect(intent.walletLaunchUri).toBe(`${MAINNET_ADDRESS}?amount=25.12345678`);
  });

  it("rejects amounts below the reliable mainnet wallet minimum", () => {
    expect(() =>
      createToccataLabIntent({
        amountKas: "0.01",
        recipientAddress: MAINNET_ADDRESS,
      }),
    ).toThrow("Claimable link amount must be at least 1 KAS.");
  });

  it("creates QR URIs through the same intent path", () => {
    expect(
      createToccataLabQrUri({
        amountKas: "1",
        recipientAddress: MAINNET_ADDRESS,
      }),
    ).toBe(`${MAINNET_ADDRESS}?amount=1`);
    expect(() =>
      createToccataLabQrUri({
        amountKas: "1",
        recipientAddress: TESTNET_ADDRESS,
      }),
    ).toThrow("Claimable links only accept mainnet kaspa: addresses.");
    expect(
      createToccataLabQrUri({
        amountKas: "999",
        recipientAddress: MAINNET_ADDRESS,
      }),
    ).toBe(`${MAINNET_ADDRESS}?amount=999`);
  });

  it("normalizes QR URI labels and messages", () => {
    expect(
      createToccataLabQrUri({
        amountKas: "1",
        label: " Custom lab ",
        message: " Mini test ",
        recipientAddress: MAINNET_ADDRESS,
      }),
    ).toBe(`${MAINNET_ADDRESS}?amount=1`);
  });

  it("derives claim and refund branches from the signed script", () => {
    const redeemScript = "ab".repeat(80);
    const redeemPush = `4c50${redeemScript}`;

    expect(readClaimableSpendMode(`41${"11".repeat(65)}51${redeemPush}`, redeemScript)).toBe(
      "claim",
    );
    expect(readClaimableSpendMode(`41${"22".repeat(65)}00${redeemPush}`, redeemScript)).toBe(
      "refund",
    );
  });

  it("rejects a signature script that reveals a different contract", () => {
    expect(() =>
      readClaimableSpendMode(`41${"11".repeat(65)}514c50${"ab".repeat(80)}`, "cd".repeat(80)),
    ).toThrow("does not reveal the registered claimable script");
  });

  it("reconstructs and validates canonical registered claimable metadata", () => {
    expect(
      validateRegisteredClaimableMetadata({
        amountSompi: "100000000",
        claimPublicKey: CLAIM_PUBLIC_KEY,
        feeSompi: "200000",
        fundingAddress: CLAIMABLE_ADDRESS,
        redeemScriptHex: CLAIMABLE_SCRIPT,
        refundLockTime: "500000000",
        refundPublicKey: REFUND_PUBLIC_KEY,
      }),
    ).toMatchObject({
      amountSompi: 100_000_000n,
      feeSompi: 200_000n,
      fundingAddress: CLAIMABLE_ADDRESS,
      redeemScriptHex: CLAIMABLE_SCRIPT,
    });
  });

  it("rejects metadata that does not match the canonical script", () => {
    expect(() =>
      validateRegisteredClaimableMetadata({
        amountSompi: "100000000",
        claimPublicKey: CLAIM_PUBLIC_KEY,
        feeSompi: "200000",
        fundingAddress: MAINNET_ADDRESS,
        redeemScriptHex: CLAIMABLE_SCRIPT,
        refundLockTime: "500000000",
        refundPublicKey: REFUND_PUBLIC_KEY,
      }),
    ).toThrow("Funding address does not match");
  });

  it("keeps legacy funded links broadcastable while enforcing the new registration minimum", () => {
    const legacy = {
      amountSompi: "25000000",
      claimPublicKey: CLAIM_PUBLIC_KEY,
      feeSompi: "200000",
      fundingAddress: CLAIMABLE_ADDRESS,
      redeemScriptHex: CLAIMABLE_SCRIPT,
      refundLockTime: "500000000",
      refundPublicKey: REFUND_PUBLIC_KEY,
    };

    expect(() => validateRegisteredClaimableMetadata(legacy)).toThrow(
      "Claim amount must be at least 1 KAS",
    );
    expect(
      validateRegisteredClaimableMetadata(legacy, { allowLegacyAmount: true }).amountSompi,
    ).toBe(25_000_000n);
  });
});
