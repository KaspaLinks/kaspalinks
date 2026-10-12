import { readFileSync } from "node:fs";

import { buildKaspaAddressScriptPublicKeyHex } from "@kaspa-actions/kaspa";
import {
  decodeGiveawayV6Witness,
  reconstructGiveawayV6,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ReconstructionConfig,
} from "@kaspa-actions/kaspa-indexer";
import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
  buildGiveawayV6RegistrationTransaction,
} from "./giveaway-v6-registration";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  shard: { redeemScriptHex: string; templateHashHex: string };
  prize: { templateHashHex: string };
};

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: 500_000_000n,
  returnAtDaa: 500_100_000n,
  entropyTargetBlueScore: 500_000_100n,
  shardCount: 4,
  treeDepth: 10,
  maxEntriesPerShard: 8,
  returnScriptPublicKeyHex: "000051",
};

const family: GiveawayV6FamilyDescriptor = {
  genesisOutpoint: { transactionId: "01".repeat(32), outputIndex: 2 },
  covenantIdHex: "42".repeat(32),
  prizeTemplateHashHex: fixture.prize.templateHashHex,
  shardTemplateHashHex: fixture.shard.templateHashHex,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 10_000_000n,
  activationFeeSompi: 10_000_000n,
  freezeFeeSompi: 33_000_000n,
  drawFeeSompi: 18_000_000n,
  returnFeeSompi: 2_000_000n,
};

const activationId = "10".repeat(32);
const activation = {
  kind: "activate" as const,
  transactionId: activationId,
  blockDaaScore: 499_000_000n,
  prizeOutputIndex: 0,
  shardOutputIndexes: [1, 2, 3, 4],
};
const payoutScriptPublicKeyHex = buildKaspaAddressScriptPublicKeyHex(
  "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
);

describe("Giveaway V6 registration transaction", () => {
  it("builds the exact keyless state transition for a public payout address", () => {
    const snapshot = reconstructGiveawayV6(config, [activation]);
    const result = buildGiveawayV6RegistrationTransaction({
      config,
      family,
      activationBlockDaaScore: activation.blockDaaScore,
      payoutScriptPublicKeyHex,
      shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
      snapshot,
    });
    const witness = decodeGiveawayV6Witness(result.signatureScriptHex);
    const transaction = JSON.parse(result.transactionSafeJson) as {
      inputs: Array<{ computeBudget: number; index: number; transactionId: string }>;
      outputs: Array<{
        covenant: { authorizingInput: number; covenantId: string };
        value: string;
      }>;
    };

    expect(result).toMatchObject({
      computeBudget: GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
      computeMass: "92026",
      feeMass: "92026",
      feeSompi: "10000000",
      fundingAmountSompi: "101000000",
      minimumFeeSompi: "9202600",
      outputAmountSompi: "91000000",
      transientMass: "183824",
    });
    expect(transaction.inputs).toEqual([
      expect.objectContaining({
        computeBudget: 457,
        index: result.shardIndex + 1,
        transactionId: activationId,
      }),
    ]);
    expect(transaction.outputs).toEqual([
      expect.objectContaining({
        covenant: { authorizingInput: 0, covenantId: family.covenantIdHex },
        value: "91000000",
      }),
    ]);
    expect(witness).toMatchObject({
      contract: "shard",
      method: "register",
      payoutScriptPublicKeyHex,
      appendSiblingCount: 10,
      addressSiblingCount: 256,
    });
    expect(result.transactionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(result).not.toHaveProperty("privateKey");
    expect(result).not.toHaveProperty("recovery");
  });

  it("uses the prior registration's confirmed DAA score for the successor input", () => {
    const empty = reconstructGiveawayV6(config, [activation]);
    const first = buildGiveawayV6RegistrationTransaction({
      config,
      family,
      activationBlockDaaScore: activation.blockDaaScore,
      payoutScriptPublicKeyHex,
      shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
      snapshot: empty,
    });
    const snapshot = reconstructGiveawayV6(config, [
      activation,
      {
        kind: "register",
        transactionId: first.transactionId,
        blockDaaScore: 499_000_010n,
        shardIndex: first.shardIndex,
        consumedOutpoint: {
          transactionId: first.fundingTransactionId,
          outputIndex: first.fundingOutputIndex,
        },
        producedOutputIndex: 0,
        payoutScriptPublicKeyHex,
      },
    ]);

    const second = buildGiveawayV6RegistrationTransaction({
      config,
      family,
      activationBlockDaaScore: activation.blockDaaScore,
      payoutScriptPublicKeyHex: buildKaspaAddressScriptPublicKeyHex(
        "kaspa:qpy6l7q6apd79nqw00drvjtr83hrj95ma582r0g24ttlpuh57hmecd09de4en",
      ),
      shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
      snapshot,
    });
    const transaction = JSON.parse(second.transactionSafeJson) as {
      inputs: Array<{ utxo: { blockDaaScore: string } }>;
    };
    expect(transaction.inputs[0]?.utxo.blockDaaScore).toBe("499000010");
  });
});
