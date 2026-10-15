import { readFileSync } from "node:fs";

import { Network } from "@kaspa-actions/db";
import { describe, expect, it, vi } from "vitest";

import {
  GIVEAWAY_V6_ENTROPY_IMAGE_ID_HEX,
  GiveawayV6CompilerError,
  compileGiveawayV6Bootstrap,
  type GiveawayV6CompilerInvocation,
} from "./giveaway-v6-compiler";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  shard: {
    redeemScriptHex: string;
    stateSpan: { len: number; offset: number };
    templateHashHex: string;
  };
  prize: {
    redeemScriptHex: string;
    stateSpan: { len: number; offset: number };
    templateHashHex: string;
  };
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

const economics = {
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 10_000_000n,
  activationFeeSompi: 10_000_000n,
  freezeFeeSompi: 33_000_000n,
  drawFeeSompi: 18_000_000n,
  returnFeeSompi: 2_000_000n,
} as const;

describe("Giveaway V6 compiler adapter", () => {
  it("compiles the shard first and binds the reviewed entropy verifier into the prize", async () => {
    const calls: GiveawayV6CompilerInvocation[] = [];
    const runner = vi.fn(async (invocation: GiveawayV6CompilerInvocation) => {
      calls.push(invocation);
      return artifact(invocation.contractName);
    });

    const result = await compileGiveawayV6Bootstrap({
      network: Network.MAINNET,
      config,
      economics,
      runner,
    });

    expect(calls.map((call) => call.contractName)).toEqual([
      "GiveawayEntryShardV6",
      "GiveawayPrizeShardsV6",
    ]);
    const prizeArgs = calls[1]!.constructorArgs;
    expect(Buffer.from(prizeArgs[15]!.value as number[]).toString("hex")).toBe(
      GIVEAWAY_V6_ENTROPY_IMAGE_ID_HEX,
    );
    expect(Buffer.from(prizeArgs[19]!.value as number[]).toString("hex")).toBe(
      fixture.shard.templateHashHex,
    );
    expect(prizeArgs[20]).toEqual({ kind: "int", value: 1 });
    expect(prizeArgs[21]).toEqual({ kind: "int", value: 37_040 });
    expect(result).toMatchObject({
      expectedFundingSompi: 514_000_000n,
      fundingScriptPublicKeyHex:
        "0000aa204a8e2b7b51b77e83cf3a2d057cee6eace51ebc2dc4f9c9600c705d048a4456dd87",
    });
  });

  it("rejects a compiler artifact whose stated template hash disagrees with its bytecode", async () => {
    const runner = async (invocation: GiveawayV6CompilerInvocation) => {
      const value = artifact(invocation.contractName);
      if (invocation.contractName === "GiveawayEntryShardV6") {
        value.contracts[invocation.contractName]!.compiled.template_hash = [...Buffer.alloc(32, 1)];
      }
      return value;
    };

    await expect(
      compileGiveawayV6Bootstrap({
        network: Network.MAINNET,
        config,
        economics,
        runner,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GiveawayV6CompilerError>>({ code: "INVALID_ARTIFACT" }),
    );
  });

  it("rejects artifacts from a different ABI version", async () => {
    const runner = async (invocation: GiveawayV6CompilerInvocation) => ({
      ...artifact(invocation.contractName),
      compiler_version: "2.0.0",
    });

    await expect(
      compileGiveawayV6Bootstrap({
        network: Network.MAINNET,
        config,
        economics,
        runner,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GiveawayV6CompilerError>>({ code: "INVALID_ARTIFACT" }),
    );
  });
});

function artifact(contractName: GiveawayV6CompilerInvocation["contractName"]) {
  const value = contractName === "GiveawayEntryShardV6" ? fixture.shard : fixture.prize;
  return {
    schema_version: 1,
    compiler_version: "0.1.0",
    contracts: {
      [contractName]: {
        compiled: {
          bytecode: [...Buffer.from(value.redeemScriptHex, "hex")],
          state_span: value.stateSpan,
          template_hash: [...Buffer.from(value.templateHashHex, "hex")],
        },
      },
    },
  };
}
