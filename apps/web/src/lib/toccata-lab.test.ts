import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { giveawayV6PayToScriptHashScriptPublicKeyHex } from "@kaspa-actions/kaspa-indexer";

import {
  createToccataClaimableAutoReturnScript,
  createToccataLabQrUri,
  createToccataLabIntent,
  readClaimableSpendMode,
  TOCCATA_LAB_DEFAULT_LABEL,
  validateGiveawayV6ActivationBroadcastSafeJson,
  validateGiveawayV6RegistrationBroadcastSafeJson,
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

  it("accepts the reviewed five-output keyless V6 activation shape", () => {
    const activation = giveawayV6ActivationSafeJson();

    expect(validateGiveawayV6ActivationBroadcastSafeJson(JSON.stringify(activation))).toBe(
      "aa".repeat(32),
    );
    activation.outputs[4]!.covenant.covenantId = "cc".repeat(32);
    expect(() => validateGiveawayV6ActivationBroadcastSafeJson(JSON.stringify(activation))).toThrow(
      /share one covenant id/iu,
    );
  });

  it.each([
    [8, 2],
    [16, 3],
    [32, 5],
  ])("accepts the activation of a %i-person giveaway with %i outputs", (_cap, outputs) => {
    const activation = giveawayV6ActivationSafeJson();
    activation.outputs = activation.outputs.slice(0, outputs);

    expect(validateGiveawayV6ActivationBroadcastSafeJson(JSON.stringify(activation))).toBe(
      "aa".repeat(32),
    );
  });

  it.each([1, 4, 6])("rejects an activation with %i outputs", (outputs) => {
    const activation = giveawayV6ActivationSafeJson();
    activation.outputs = Array.from({ length: outputs }, () => activation.outputs[1]!);

    expect(() => validateGiveawayV6ActivationBroadcastSafeJson(JSON.stringify(activation))).toThrow(
      /one prize and one, two or four shards/iu,
    );
  });

  it("accepts only a one-output V6 register witness for public registration", () => {
    const registration = giveawayV6RegistrationSafeJson();

    expect(validateGiveawayV6RegistrationBroadcastSafeJson(JSON.stringify(registration))).toBe(
      "ee".repeat(32),
    );
    registration.outputs.push(structuredClone(registration.outputs[0]!));
    expect(() =>
      validateGiveawayV6RegistrationBroadcastSafeJson(JSON.stringify(registration)),
    ).toThrow(/exactly one shard successor/iu);
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

  describe("auto-return (v2) metadata", () => {
    const v2Script = createToccataClaimableAutoReturnScript({
      feeSompi: "200000",
      linkPublicKey: CLAIM_PUBLIC_KEY,
      refundLockTime: "500000000",
      returnAddress: MAINNET_ADDRESS,
    });
    const v2 = {
      amountSompi: "100200000",
      claimPublicKey: CLAIM_PUBLIC_KEY,
      feeSompi: "200000",
      fundingAddress: v2Script.fundingAddress,
      redeemScriptHex: v2Script.redeemScriptHex,
      refundLockTime: "500000000",
      returnAddress: MAINNET_ADDRESS,
      scriptVersion: 2 as const,
    };

    it("rebuilds the v2 script from public inputs and has no refund key", () => {
      expect(validateRegisteredClaimableMetadata(v2)).toMatchObject({
        fundingAddress: v2Script.fundingAddress,
        refundPublicKey: null,
        returnAddress: MAINNET_ADDRESS,
        scriptVersion: 2,
      });
    });

    it("rejects a v2 registration whose return address differs from the script", () => {
      expect(() =>
        validateRegisteredClaimableMetadata({
          ...v2,
          returnAddress: "kaspa:qrpuhc8c998cdp4fkgjljspuwtetvjhy022k0a00da4dxh3kkz89qa96gge5r",
        }),
      ).toThrow("does not match the canonical claimable script");
    });

    it("requires a mainnet return address and a small fee", () => {
      expect(() => validateRegisteredClaimableMetadata({ ...v2, returnAddress: null })).toThrow(
        "Return address is required",
      );
      expect(() =>
        validateRegisteredClaimableMetadata({ ...v2, returnAddress: TESTNET_ADDRESS }),
      ).toThrow("mainnet");
      expect(() =>
        validateRegisteredClaimableMetadata({
          ...v2,
          amountSompi: "200000000",
          feeSompi: "20000000",
        }),
      ).toThrow("0.1 KAS");
    });

    it("still requires a refund key for classic links", () => {
      expect(() =>
        validateRegisteredClaimableMetadata({
          amountSompi: "100000000",
          claimPublicKey: CLAIM_PUBLIC_KEY,
          feeSompi: "200000",
          fundingAddress: CLAIMABLE_ADDRESS,
          redeemScriptHex: CLAIMABLE_SCRIPT,
          refundLockTime: "500000000",
          refundPublicKey: null,
        }),
      ).toThrow("Refund public key");
    });

    it("recognizes the keyless return branch selector", () => {
      const redeemPush = `4c${(v2Script.redeemScriptHex.length / 2).toString(16)}${v2Script.redeemScriptHex}`;
      expect(readClaimableSpendMode(`00${redeemPush}`, v2Script.redeemScriptHex)).toBe("return");
      expect(
        readClaimableSpendMode(`41${"11".repeat(65)}51${redeemPush}`, v2Script.redeemScriptHex),
      ).toBe("claim");
    });
  });
});

function giveawayV6ActivationSafeJson() {
  return {
    id: "aa".repeat(32),
    inputs: [
      {
        computeBudget: 147,
        index: 2,
        sequence: "0",
        sigOpCount: 0,
        signatureScript: "51",
        transactionId: "bb".repeat(32),
        utxo: { amount: "514000000" },
      },
    ],
    lockTime: "0",
    outputs: Array.from({ length: 5 }, (_, index) => ({
      covenant: { authorizingInput: 0, covenantId: "dd".repeat(32) },
      scriptPublicKey: "000051",
      value: index === 0 ? "100000000" : "101000000",
    })),
    subnetworkId: "00".repeat(20),
    version: 1,
  };
}

function giveawayV6RegistrationSafeJson() {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../../labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json", import.meta.url),
      "utf8",
    ),
  ) as {
    shard: { callPrefixHex: { register: string }; redeemScriptHex: string };
  };
  const redeemBytes = fixture.shard.redeemScriptHex.length / 2;
  const length = Buffer.alloc(2);
  length.writeUInt16LE(redeemBytes);
  const signatureScript =
    fixture.shard.callPrefixHex.register +
    `4d${length.toString("hex")}` +
    fixture.shard.redeemScriptHex;
  const shardScriptPublicKeyHex = giveawayV6PayToScriptHashScriptPublicKeyHex(
    fixture.shard.redeemScriptHex,
  );
  return {
    id: "ee".repeat(32),
    inputs: [
      {
        computeBudget: 457,
        index: 1,
        sequence: "0",
        sigOpCount: 0,
        signatureScript,
        transactionId: "ff".repeat(32),
        utxo: { amount: "101000000", scriptPublicKey: shardScriptPublicKeyHex },
      },
    ],
    lockTime: "0",
    outputs: [
      {
        covenant: { authorizingInput: 0, covenantId: "dd".repeat(32) },
        scriptPublicKey: `0000aa20${"11".repeat(32)}87`,
        value: "91000000",
      },
    ],
    subnetworkId: "00".repeat(20),
    version: 1,
  };
}
