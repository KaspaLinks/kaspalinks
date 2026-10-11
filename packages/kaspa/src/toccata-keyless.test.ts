import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { buildToccataKeylessCovenantSpend } from "./toccata-keyless";

const kaspa = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const REDEEM_SCRIPT = "51";
const FUNDING_SCRIPT = (() => {
  const value = kaspa.payToScriptHashScript(REDEEM_SCRIPT).toJSON() as {
    script: string;
    version: number;
  };
  return `${value.version.toString(16).padStart(4, "0")}${value.script}`;
})();
const COVENANT_ID = "22".repeat(32);

function build(overrides: Record<string, unknown> = {}) {
  return buildToccataKeylessCovenantSpend({
    computeBudget: 147,
    feeSompi: 2_000_000n,
    funding: {
      amountSompi: 102_000_000n,
      blockDaaScore: 536_000_000n,
      outputIndex: 2,
      scriptPublicKeyHex: FUNDING_SCRIPT,
      transactionId: "11".repeat(32),
    },
    invocationStackHex: ["31", "32", "a2b5a377"],
    outputs: [
      {
        amountSompi: 100_000_000n,
        covenant: { authorizingInput: 0, covenantIdHex: COVENANT_ID },
        scriptPublicKeyHex: "000051",
      },
    ],
    redeemScriptHex: REDEEM_SCRIPT,
    ...overrides,
  });
}

describe("Toccata keyless covenant transaction", () => {
  it("preserves the exact outpoint, witness and covenant outputs through SafeJSON", () => {
    const result = build();
    const transaction = kaspa.Transaction.deserializeFromSafeJSON(result.transactionSafeJson);
    const input = transaction.inputs[0]!;
    const output = JSON.parse(result.transactionSafeJson).outputs[0] as {
      covenant?: { authorizingInput: number; covenantId: string };
      value: string;
    };

    expect(result).toMatchObject({
      computeBudget: 147,
      feeSompi: "2000000",
      fundingAmountSompi: "102000000",
      fundingOutputIndex: 2,
      fundingTransactionId: "11".repeat(32),
    });
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(BigInt(result.minimumFeeSompi)).toBeLessThanOrEqual(2_000_000n);
    expect(BigInt(result.feeMass)).toBeGreaterThan(0n);
    expect(BigInt(result.computeMass)).toBeGreaterThan(0n);
    expect(BigInt(result.transientMass)).toBeGreaterThan(0n);
    expect(BigInt(result.storageMass)).toBeGreaterThanOrEqual(0n);
    expect(BigInt(result.mass)).toBeGreaterThan(0n);
    expect(input.previousOutpoint.transactionId).toBe("11".repeat(32));
    expect(input.previousOutpoint.index).toBe(2);
    expect(input.computeBudget).toBe(147);
    expect(input.signatureScript).toBe(result.signatureScriptHex);
    expect(output).toMatchObject({
      covenant: { authorizingInput: 0, covenantId: COVENANT_ID },
      value: "100000000",
    });
  });

  it("rejects a redeem script that does not own the committed funding output", () => {
    expect(() =>
      build({ funding: { ...baseFunding(), scriptPublicKeyHex: "000051" } }),
    ).toThrowError(/does not match the committed funding script/iu);
  });

  it("rejects any value redirection or hidden fee change", () => {
    expect(() =>
      build({
        outputs: [
          {
            amountSompi: 99_999_999n,
            covenant: { authorizingInput: 0, covenantIdHex: COVENANT_ID },
            scriptPublicKeyHex: "000051",
          },
        ],
      }),
    ).toThrowError(/exact covenant outputs plus the fixed fee/iu);
  });

  it("rejects covenant bindings to an input outside the transaction", () => {
    expect(() =>
      build({
        outputs: [
          {
            amountSompi: 100_000_000n,
            covenant: { authorizingInput: 1, covenantIdHex: COVENANT_ID },
            scriptPublicKeyHex: "000051",
          },
        ],
      }),
    ).toThrowError(/only transaction input at index zero/iu);
  });
});

function baseFunding() {
  return {
    amountSompi: 102_000_000n,
    blockDaaScore: 536_000_000n,
    outputIndex: 2,
    scriptPublicKeyHex: FUNDING_SCRIPT,
    transactionId: "11".repeat(32),
  };
}
