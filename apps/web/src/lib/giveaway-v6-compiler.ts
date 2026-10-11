import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildGiveawayV6BootstrapCreateData } from "@kaspa-actions/application";
import { Network } from "@kaspa-actions/db";
import {
  GIVEAWAY_V6_PRIZE_SOURCE_SHA256,
  GIVEAWAY_V6_SHARD_SOURCE_SHA256,
  giveawayV6TemplateHashHex,
  reconstructGiveawayV6,
  type GiveawayV6FamilyTerms,
  type GiveawayV6ReconstructionConfig,
} from "@kaspa-actions/kaspa-indexer";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const MAX_COMPILER_OUTPUT_BYTES = 2_000_000;
const COMPILER_TIMEOUT_MS = 20_000;
const SILVERSCRIPT_ABI_VERSION = "0.1.0";
const ZERO_HASH = "00".repeat(32);

export const GIVEAWAY_V6_ENTROPY_IMAGE_ID_HEX =
  "a402f88f9b89afd2eb5e5f6cdc96f67af2ff4d4da70e1e6a4767a99c26b692b1";

type ArtifactValue = { kind: "bytes"; value: number[] } | { kind: "int"; value: number };

const byteArraySchema = z.array(z.number().int().min(0).max(255)).max(65_535);
const compiledContractSchema = z
  .object({
    compiled: z
      .object({
        bytecode: byteArraySchema,
        state_span: z
          .object({
            len: z.number().int().positive(),
            offset: z.number().int().nonnegative(),
          })
          .strict(),
        template_hash: byteArraySchema.length(32),
      })
      .passthrough(),
  })
  .passthrough();
const artifactSchema = z
  .object({
    compiler_version: z.literal(SILVERSCRIPT_ABI_VERSION),
    contracts: z.record(compiledContractSchema),
    schema_version: z.literal(1),
  })
  .passthrough();

export type GiveawayV6CompilerEconomics = Omit<
  GiveawayV6FamilyTerms,
  "prizeTemplateHashHex" | "shardTemplateHashHex"
>;

export type GiveawayV6CompilerInvocation = {
  constructorArgs: readonly ArtifactValue[];
  contractName: "GiveawayEntryShardV6" | "GiveawayPrizeShardsV6";
  sourcePath: string;
};

export type GiveawayV6CompilerRunner = (
  invocation: GiveawayV6CompilerInvocation,
) => Promise<unknown>;

export class GiveawayV6CompilerError extends Error {
  readonly code: "COMPILER_FAILED" | "INVALID_ARTIFACT" | "INVALID_INPUT" | "SOURCE_MISMATCH";

  constructor(
    code: "COMPILER_FAILED" | "INVALID_ARTIFACT" | "INVALID_INPUT" | "SOURCE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "GiveawayV6CompilerError";
    this.code = code;
  }
}

/**
 * Compiles one public-only Giveaway V6 contract family with the pinned
 * SilverScript release and returns a fully reviewed pre-funding record.
 */
export async function compileGiveawayV6Bootstrap(input: {
  network: Network;
  config: GiveawayV6ReconstructionConfig;
  economics: GiveawayV6CompilerEconomics;
  runner?: GiveawayV6CompilerRunner;
  sourceDirectory?: string;
}) {
  const configuredSourceDirectory = process.env.SILVERSCRIPT_SOURCE_DIR?.trim();
  const sourceDirectory =
    input.sourceDirectory ||
    configuredSourceDirectory ||
    join(process.cwd(), "labs", "claimable-script");
  const prizeSourcePath = join(sourceDirectory, "giveaway_prize_shards_v6.sil");
  const shardSourcePath = join(sourceDirectory, "giveaway_entry_shard_v6.sil");
  await Promise.all([
    verifySource(shardSourcePath, GIVEAWAY_V6_SHARD_SOURCE_SHA256),
    verifySource(prizeSourcePath, GIVEAWAY_V6_PRIZE_SOURCE_SHA256),
  ]);

  const emptySnapshot = reconstructGiveawayV6(input.config, []);
  const emptyShard = emptySnapshot.shards[0];
  if (!emptyShard) invalidInput("Giveaway V6 needs at least one entry shard.");

  const runner = input.runner ?? runPinnedSilverc;
  const shardArtifact = extractContract(
    await runner({
      constructorArgs: buildShardConstructorArgs(input.config, input.economics, emptyShard),
      contractName: "GiveawayEntryShardV6",
      sourcePath: shardSourcePath,
    }),
    "GiveawayEntryShardV6",
    { len: 117, offset: 1 },
  );
  const shardTemplateHashHex = bytesToHex(shardArtifact.templateHash);
  const shardTemplateRedeemScriptHex = bytesToHex(shardArtifact.bytecode);
  verifyTemplate("shard", shardTemplateRedeemScriptHex, shardTemplateHashHex);

  const shardPrefix = shardArtifact.bytecode.slice(0, shardArtifact.stateSpan.offset);
  const shardSuffix = shardArtifact.bytecode.slice(
    shardArtifact.stateSpan.offset + shardArtifact.stateSpan.len,
  );
  const prizeArtifact = extractContract(
    await runner({
      constructorArgs: buildPrizeConstructorArgs(
        input.config,
        input.economics,
        emptyShard,
        shardTemplateHashHex,
        shardPrefix.length,
        shardSuffix.length,
      ),
      contractName: "GiveawayPrizeShardsV6",
      sourcePath: prizeSourcePath,
    }),
    "GiveawayPrizeShardsV6",
    { len: 51, offset: 1 },
  );
  const prizeTemplateHashHex = bytesToHex(prizeArtifact.templateHash);
  const prizeRedeemScriptHex = bytesToHex(prizeArtifact.bytecode);
  verifyTemplate("prize", prizeRedeemScriptHex, prizeTemplateHashHex);

  return buildGiveawayV6BootstrapCreateData({
    network: input.network,
    config: input.config,
    familyTerms: {
      ...input.economics,
      prizeTemplateHashHex,
      shardTemplateHashHex,
    },
    prizeRedeemScriptHex,
    shardTemplateRedeemScriptHex,
  });
}

/** Runs the fixed CLI path without shell expansion or user-controlled flags. */
export async function runPinnedSilverc(invocation: GiveawayV6CompilerInvocation): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "kaspa-links-silverc-"));
  const constructorArgsPath = join(directory, "constructor-args.json");
  try {
    await writeFile(constructorArgsPath, JSON.stringify(invocation.constructorArgs), {
      encoding: "utf8",
      mode: 0o600,
    });
    const executable = process.env.SILVERC_BIN?.trim() || "silverc";
    const { stdout } = await execFileAsync(
      executable,
      [invocation.sourcePath, "--constructor-args", constructorArgsPath, "--stdout"],
      {
        encoding: "utf8",
        maxBuffer: MAX_COMPILER_OUTPUT_BYTES,
        timeout: COMPILER_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new GiveawayV6CompilerError(
      "COMPILER_FAILED",
      "The pinned SilverScript compiler could not produce a Giveaway V6 artifact.",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function buildShardConstructorArgs(
  config: GiveawayV6ReconstructionConfig,
  economics: GiveawayV6CompilerEconomics,
  emptyShard: { entriesRootHex: string; addressRootHex: string },
): ArtifactValue[] {
  return [
    bytes(config.giveawayIdHex, "giveaway ID"),
    integer(config.closesAtDaa, "closing DAA score"),
    integer(BigInt(config.shardCount + 1), "family size"),
    integer(BigInt(config.shardCount), "shard count"),
    integer(BigInt(config.treeDepth), "tree depth"),
    integer(BigInt(config.maxEntriesPerShard), "maximum shard entries"),
    integer(economics.entryFeeSompi, "entry fee"),
    integer(0n, "initial shard index"),
    integer(0n, "initial shard count"),
    bytes(emptyShard.entriesRootHex, "empty entry root"),
    bytes(emptyShard.addressRootHex, "empty address root"),
    bytes(ZERO_HASH, "empty pending hash"),
  ];
}

function buildPrizeConstructorArgs(
  config: GiveawayV6ReconstructionConfig,
  economics: GiveawayV6CompilerEconomics,
  emptyShard: { entriesRootHex: string; addressRootHex: string },
  shardTemplateHashHex: string,
  shardPrefixLength: number,
  shardSuffixLength: number,
): ArtifactValue[] {
  return [
    bytes(config.giveawayIdHex, "giveaway ID"),
    integer(config.closesAtDaa, "closing DAA score"),
    integer(BigInt(config.shardCount + 1), "family size"),
    integer(BigInt(config.shardCount), "shard count"),
    integer(BigInt(config.treeDepth), "tree depth"),
    integer(BigInt(config.maxEntriesPerShard), "maximum shard entries"),
    integer(economics.prizeValueSompi, "prize value"),
    integer(economics.shardValueSompi, "shard reserve"),
    integer(economics.entryFeeSompi, "entry fee"),
    integer(economics.activationFeeSompi, "activation fee"),
    integer(economics.freezeFeeSompi, "freeze fee"),
    integer(economics.drawFeeSompi, "draw fee"),
    integer(economics.returnFeeSompi, "return fee"),
    integer(config.returnAtDaa, "fallback return DAA score"),
    integer(config.entropyTargetBlueScore, "entropy target blue score"),
    bytes(GIVEAWAY_V6_ENTROPY_IMAGE_ID_HEX, "entropy verifier image ID"),
    bytes(config.returnScriptPublicKeyHex, "return script public key"),
    bytes(emptyShard.entriesRootHex, "empty entry root"),
    bytes(emptyShard.addressRootHex, "empty address root"),
    bytes(shardTemplateHashHex, "shard template hash"),
    integer(BigInt(shardPrefixLength), "shard prefix length"),
    integer(BigInt(shardSuffixLength), "shard suffix length"),
    integer(0n, "initial prize phase"),
    bytes(ZERO_HASH, "initial frozen root"),
    integer(0n, "initial prize entry count"),
  ];
}

async function verifySource(path: string, expectedSha256: string): Promise<void> {
  let source: Buffer;
  try {
    source = await readFile(path);
  } catch {
    throw new GiveawayV6CompilerError("SOURCE_MISMATCH", "SilverScript source is unavailable.");
  }
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expectedSha256) {
    throw new GiveawayV6CompilerError(
      "SOURCE_MISMATCH",
      "SilverScript source does not match the reviewed Giveaway V6 release.",
    );
  }
}

function extractContract(
  value: unknown,
  contractName: GiveawayV6CompilerInvocation["contractName"],
  expectedStateSpan: { len: number; offset: number },
) {
  const parsed = artifactSchema.safeParse(value);
  if (!parsed.success) invalidArtifact("SilverScript returned an invalid ABI artifact.");
  const contract = parsed.data.contracts[contractName];
  if (!contract) invalidArtifact(`SilverScript artifact is missing ${contractName}.`);
  const { bytecode, state_span: stateSpan, template_hash: templateHash } = contract.compiled;
  if (
    bytecode.length === 0 ||
    bytecode.length > 65_535 ||
    stateSpan.offset !== expectedStateSpan.offset ||
    stateSpan.len !== expectedStateSpan.len ||
    stateSpan.offset + stateSpan.len > bytecode.length
  ) {
    invalidArtifact(`${contractName} uses an unexpected compiled state layout.`);
  }
  return { bytecode, stateSpan, templateHash };
}

function verifyTemplate(
  contract: "prize" | "shard",
  redeemScriptHex: string,
  expectedTemplateHashHex: string,
): void {
  if (giveawayV6TemplateHashHex(contract, redeemScriptHex) !== expectedTemplateHashHex) {
    invalidArtifact("SilverScript artifact template hash does not match its bytecode.");
  }
}

function integer(value: bigint, label: string): ArtifactValue {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    invalidInput(`${label} must be a non-negative safe integer for SilverScript.`);
  }
  return { kind: "int", value: Number(value) };
}

function bytes(value: string, label: string): ArtifactValue {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^(?:[0-9a-f]{2})+$/u.test(normalized)) {
    invalidInput(`${label} must be even-length hexadecimal.`);
  }
  return { kind: "bytes", value: [...Buffer.from(normalized, "hex")] };
}

function bytesToHex(value: readonly number[]): string {
  return Buffer.from(value).toString("hex");
}

function invalidArtifact(message: string): never {
  throw new GiveawayV6CompilerError("INVALID_ARTIFACT", message);
}

function invalidInput(message: string): never {
  throw new GiveawayV6CompilerError("INVALID_INPUT", message);
}
