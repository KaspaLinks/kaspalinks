import { readFileSync } from "node:fs";

import { GiveawayV6BootstrapStatus, Network, type PrismaClient } from "@kaspa-actions/db";
import { decodeGiveawayV6Witness } from "@kaspa-actions/kaspa-indexer";
import { describe, expect, it, vi } from "vitest";

import {
  GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
  buildGiveawayV6ActivationTransaction,
  persistGiveawayV6ActivationFailure,
  persistGiveawayV6ActivationPlan,
  persistGiveawayV6ActivationSubmitted,
} from "./giveaway-v6-activation";
import {
  buildGiveawayV6BootstrapCreateData,
  prepareGiveawayV6BootstrapBinding,
  type GiveawayV6BootstrapRecord,
  type GiveawayV6BoundBootstrapRecord,
} from "./giveaway-v6-bootstrap";

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
  prize: { redeemScriptHex: string; templateHashHex: string };
};

const config = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: 500_000_000n,
  returnAtDaa: 500_100_000n,
  entropyTargetBlueScore: 500_000_100n,
  shardCount: 4,
  treeDepth: 10,
  maxEntriesPerShard: 8,
  returnScriptPublicKeyHex: "000051",
} as const;

const familyTerms = {
  prizeTemplateHashHex: fixture.prize.templateHashHex,
  shardTemplateHashHex: fixture.shard.templateHashHex,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 10_000_000n,
  activationFeeSompi: 10_000_000n,
  freezeFeeSompi: 33_000_000n,
  drawFeeSompi: 18_000_000n,
  returnFeeSompi: 2_000_000n,
} as const;

function boundRecord(): GiveawayV6BoundBootstrapRecord {
  const bootstrap: GiveawayV6BootstrapRecord = {
    id: "bootstrap-1",
    giveawayId: "giveaway-1",
    ...buildGiveawayV6BootstrapCreateData({
      network: Network.MAINNET,
      config,
      familyTerms,
      prizeRedeemScriptHex: fixture.prize.redeemScriptHex,
      shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
    }),
  };
  const prepared = prepareGiveawayV6BootstrapBinding({
    record: bootstrap,
    funding: {
      transactionId: "01".repeat(32),
      outputIndex: 2,
      amountSompi: bootstrap.expectedFundingSompi,
      scriptPublicKeyHex: bootstrap.fundingScriptPublicKeyHex,
      covenantIdHex: null,
      blockDaaScore: 499_000_000n,
      acceptingBlockHash: "aa".repeat(32),
    },
  });
  return {
    ...bootstrap,
    ...prepared.bootstrapUpdate,
    activationOutputs: prepared.bootstrapUpdate.activationOutputs,
    status: GiveawayV6BootstrapStatus.BOUND,
  };
}

describe("Giveaway V6 activation transaction", () => {
  it("builds the exact keyless SilverScript genesis transition", () => {
    const result = buildGiveawayV6ActivationTransaction(boundRecord());
    const transaction = JSON.parse(result.transactionSafeJson) as {
      inputs: Array<{
        computeBudget: number;
        index: number;
        signatureScript: string;
        transactionId: string;
      }>;
      outputs: Array<{
        covenant: { authorizingInput: number; covenantId: string };
        scriptPublicKey: string;
        value: string;
      }>;
    };
    const witness = decodeGiveawayV6Witness(result.signatureScriptHex);

    expect(result).toMatchObject({
      computeMass: "64709",
      computeBudget: GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
      feeMass: "96318",
      feeSompi: "10000000",
      fundingAmountSompi: "514000000",
      fundingOutputIndex: 2,
      fundingTransactionId: "01".repeat(32),
      minimumFeeSompi: "9631800",
      storageMass: "196467",
      transientMass: "192636",
    });
    expect(BigInt(result.minimumFeeSompi)).toBeLessThanOrEqual(10_000_000n);
    expect(BigInt(result.mass)).toBeGreaterThan(0n);
    expect(transaction.inputs).toEqual([
      expect.objectContaining({
        computeBudget: 147,
        index: 2,
        signatureScript: result.signatureScriptHex,
        transactionId: "01".repeat(32),
      }),
    ]);
    expect(transaction.outputs).toHaveLength(5);
    expect(transaction.outputs.map((output) => output.value)).toEqual([
      "100000000",
      "101000000",
      "101000000",
      "101000000",
      "101000000",
    ]);
    expect(
      transaction.outputs.every(
        (output) =>
          output.covenant.authorizingInput === 0 &&
          output.covenant.covenantId === result.covenantIdHex,
      ),
    ).toBe(true);
    expect(witness).toMatchObject({
      contract: "prize",
      method: "activate",
      state: { phase: 0, frozenRootHex: "00".repeat(32), entryCount: 0 },
      templateHashHex: fixture.prize.templateHashHex,
    });
    expect(result).not.toHaveProperty("privateKey");
    expect(result).not.toHaveProperty("recovery");
  });

  it("rejects a stored covenant ID that no longer matches the funding outpoint", () => {
    const record = boundRecord();
    expect(() =>
      buildGiveawayV6ActivationTransaction({ ...record, covenantIdHex: "ff".repeat(32) }),
    ).toThrowError(/covenant ID disagrees/iu);
  });

  it("rejects any stored activation-output manipulation", () => {
    const record = boundRecord();
    const outputs = structuredClone(record.activationOutputs) as Array<Record<string, unknown>>;
    outputs[0] = { ...outputs[0], amountSompi: "99999999" };

    expect(() =>
      buildGiveawayV6ActivationTransaction({ ...record, activationOutputs: outputs }),
    ).toThrowError(/activation outputs disagree/iu);
  });
});

describe("Giveaway V6 activation delivery", () => {
  const transactionId = "ab".repeat(32);
  const deliveryRecord = {
    activationTransactionId: null,
    giveawayId: "giveaway-1",
    id: "bootstrap-1",
    status: GiveawayV6BootstrapStatus.BOUND,
  } as const;

  it("persists the deterministic transaction ID before relay", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const database = databaseWithUpdateMany(updateMany);

    await persistGiveawayV6ActivationPlan(database, deliveryRecord, transactionId.toUpperCase());

    expect(updateMany).toHaveBeenCalledWith({
      data: { activationTransactionId: transactionId },
      where: {
        giveawayId: "giveaway-1",
        id: "bootstrap-1",
        OR: [{ activationTransactionId: null }, { activationTransactionId: transactionId }],
        status: GiveawayV6BootstrapStatus.BOUND,
      },
    });
  });

  it("refuses to replace a previously planned transaction", async () => {
    const updateMany = vi.fn();
    const database = databaseWithUpdateMany(updateMany);

    await expect(
      persistGiveawayV6ActivationPlan(
        database,
        { ...deliveryRecord, activationTransactionId: "cd".repeat(32) },
        transactionId,
      ),
    ).rejects.toThrow(/disagrees with reconstruction/iu);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("records submission and bounded retry failures without relay details", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const database = databaseWithUpdateMany(updateMany);
    const attemptedAt = new Date("2026-10-11T20:00:00.000Z");

    await persistGiveawayV6ActivationFailure(
      database,
      deliveryRecord,
      transactionId,
      attemptedAt,
      "ACTIVATION_RELAY_UNAVAILABLE",
    );
    await persistGiveawayV6ActivationSubmitted(
      database,
      deliveryRecord,
      transactionId,
      attemptedAt,
    );

    const calls = updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(calls[0]?.[0].data).toEqual({
      activationLastAttemptAt: attemptedAt,
      activationLastErrorCode: "ACTIVATION_RELAY_UNAVAILABLE",
    });
    expect(calls[1]?.[0].data).toEqual({
      activationLastAttemptAt: attemptedAt,
      activationLastErrorCode: null,
      activationSubmittedAt: attemptedAt,
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("relay detail");
  });
});

function databaseWithUpdateMany(updateMany: ReturnType<typeof vi.fn>): PrismaClient {
  return { giveawayV6Bootstrap: { updateMany } } as unknown as PrismaClient;
}
