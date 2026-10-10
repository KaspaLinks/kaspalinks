import { readFileSync } from "node:fs";

import { GiveawayV6BootstrapStatus, Network, type PrismaClient } from "@kaspa-actions/db";
import { describe, expect, it, vi } from "vitest";

import {
  GiveawayV6BootstrapError,
  buildGiveawayV6BootstrapCreateData,
  persistGiveawayV6BootstrapBinding,
  prepareGiveawayV6BootstrapBinding,
  type GiveawayV6BootstrapRecord,
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
  maxEntriesPerShard: 1_000,
  returnScriptPublicKeyHex: "000051",
} as const;

const familyTerms = {
  prizeTemplateHashHex: fixture.prize.templateHashHex,
  shardTemplateHashHex: fixture.shard.templateHashHex,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 100_000n,
  activationFeeSompi: 100_000n,
  freezeFeeSompi: 100_000n,
  drawFeeSompi: 100_000n,
  returnFeeSompi: 100_000n,
} as const;

function createData() {
  return buildGiveawayV6BootstrapCreateData({
    network: Network.MAINNET,
    config,
    familyTerms,
    prizeRedeemScriptHex: fixture.prize.redeemScriptHex,
    shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
  });
}

function record(): GiveawayV6BootstrapRecord {
  return {
    id: "bootstrap-1",
    giveawayId: "giveaway-1",
    ...createData(),
  };
}

describe("Giveaway V6 bootstrap binding", () => {
  it("builds one reviewed public-only Kaspium funding intent", () => {
    const data = createData();

    expect(data).toMatchObject({
      network: Network.MAINNET,
      status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
      expectedFundingSompi: 504_100_000n,
      fundingScriptPublicKeyHex:
        "0000aa20b2d16dc009ce21070541a4d7f7fec28acd414474073adbb8dd9bef3d540573ed87",
    });
    expect(data.fundingAddress).toMatch(/^kaspa:/u);
    expect(data).not.toHaveProperty("privateKey");
    expect(data).not.toHaveProperty("recovery");
  });

  it("binds the exact ordinary output and derives every genesis output locally", () => {
    const bootstrap = record();
    const prepared = prepareGiveawayV6BootstrapBinding({
      record: bootstrap,
      funding: {
        transactionId: "01".repeat(32),
        outputIndex: 0,
        amountSompi: bootstrap.expectedFundingSompi,
        scriptPublicKeyHex: bootstrap.fundingScriptPublicKeyHex,
        covenantIdHex: null,
        blockDaaScore: 499_000_000n,
        acceptingBlockHash: "aa".repeat(32),
      },
    });

    expect(prepared.family.covenantIdHex).toBe(
      "c14ba68dc683bdb26d166ae856a36b7b63c7e389f96b7985b068fbb4db820d0b",
    );
    expect(prepared.activationOutputs).toHaveLength(5);
    expect(prepared.activationOutputs.map((output) => output.amountSompi)).toEqual([
      100_000_000n,
      101_000_000n,
      101_000_000n,
      101_000_000n,
      101_000_000n,
    ]);
    expect(
      prepared.activationOutputs.every(
        (output) =>
          output.covenant.authorizingInput === 0 &&
          output.covenant.covenantIdHex === prepared.family.covenantIdHex,
      ),
    ).toBe(true);
    expect(prepared.projectionCreate.anchorHash).toBe("aa".repeat(32));
  });

  it("rejects the wrong amount, script, or a pre-bound wallet output", () => {
    const bootstrap = record();
    const funding = {
      transactionId: "01".repeat(32),
      outputIndex: 0,
      amountSompi: bootstrap.expectedFundingSompi,
      scriptPublicKeyHex: bootstrap.fundingScriptPublicKeyHex,
      covenantIdHex: null,
      blockDaaScore: 499_000_000n,
      acceptingBlockHash: "aa".repeat(32),
    } as const;

    for (const invalid of [
      { ...funding, amountSompi: funding.amountSompi - 1n },
      { ...funding, scriptPublicKeyHex: "000051" },
      { ...funding, covenantIdHex: "11".repeat(32) },
    ]) {
      expect(() =>
        prepareGiveawayV6BootstrapBinding({ record: bootstrap, funding: invalid }),
      ).toThrowError(
        expect.objectContaining<Partial<GiveawayV6BootstrapError>>({ code: "INVALID_FUNDING" }),
      );
    }
  });

  it("binds the bootstrap and creates its projection in one database transaction", async () => {
    const bootstrap = record();
    const prepared = prepareGiveawayV6BootstrapBinding({
      record: bootstrap,
      funding: {
        transactionId: "01".repeat(32),
        outputIndex: 0,
        amountSompi: bootstrap.expectedFundingSompi,
        scriptPublicKeyHex: bootstrap.fundingScriptPublicKeyHex,
        covenantIdHex: null,
        blockDaaScore: 499_000_000n,
        acceptingBlockHash: "aa".repeat(32),
      },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({ id: "projection-1" });
    const transaction = {
      giveawayV6Bootstrap: { updateMany },
      giveawayV6Projection: { create },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;

    await persistGiveawayV6BootstrapBinding(prisma, bootstrap, prepared);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: bootstrap.id,
          status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        giveawayId: bootstrap.giveawayId,
        covenantIdHex: prepared.family.covenantIdHex,
      }),
    });
  });
});
