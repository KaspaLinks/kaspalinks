import { GiveawayV6BootstrapStatus, Network, Prisma, type PrismaClient } from "@kaspa-actions/db";
import { kaspaAddressFromScriptPublicKeyHex } from "@kaspa-actions/kaspa";
import {
  GIVEAWAY_V6_COMPILER_COMMIT,
  GIVEAWAY_V6_PRIZE_SOURCE_SHA256,
  GIVEAWAY_V6_SHARD_SOURCE_SHA256,
  buildGiveawayV6PrizeRedeemScriptHex,
  buildGiveawayV6ShardRedeemScriptHex,
  deriveGiveawayV6GenesisCovenantIdHex,
  giveawayV6PayToScriptHashScriptPublicKeyHex,
  giveawayV6TemplateHashHex,
  parseGiveawayV6ConfigJson,
  parseGiveawayV6FamilyTermsJson,
  readGiveawayV6PrizeState,
  readGiveawayV6ShardState,
  reconstructGiveawayV6,
  serializeGiveawayV6ConfigJson,
  serializeGiveawayV6FamilyTermsJson,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6FamilyTerms,
  type GiveawayV6ReconstructionConfig,
} from "@kaspa-actions/kaspa-indexer";

import { buildGiveawayV6ProjectionCreateData } from "./giveaway-v6-projection.ts";

const MAX_U64 = (1n << 64n) - 1n;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SCRIPT_PATTERN = /^(?:[0-9a-f]{2})+$/u;
const ZERO_HASH = "00".repeat(32);

export type GiveawayV6BootstrapRecord = {
  id: string;
  giveawayId: string;
  network: Network;
  status: GiveawayV6BootstrapStatus;
  compilerCommit: string;
  prizeSourceSha256: string;
  shardSourceSha256: string;
  config: unknown;
  familyTerms: unknown;
  prizeRedeemScriptHex: string;
  shardTemplateRedeemScriptHex: string;
  fundingScriptPublicKeyHex: string;
  fundingAddress: string;
  expectedFundingSompi: bigint;
};

export type GiveawayV6ConfirmedFunding = {
  transactionId: string;
  outputIndex: number;
  amountSompi: bigint;
  scriptPublicKeyHex: string;
  covenantIdHex: string | null;
  blockDaaScore: bigint;
  acceptingBlockHash: string;
};

export type GiveawayV6ActivationOutput = {
  outputIndex: number;
  amountSompi: bigint;
  scriptPublicKeyHex: string;
  covenant: { authorizingInput: 0; covenantIdHex: string };
};

export type GiveawayV6ActivationOutputJson = Omit<GiveawayV6ActivationOutput, "amountSompi"> & {
  amountSompi: string;
};

export type PreparedGiveawayV6BootstrapBinding = {
  family: GiveawayV6FamilyDescriptor;
  activationOutputs: readonly GiveawayV6ActivationOutput[];
  bootstrapUpdate: {
    status: GiveawayV6BootstrapStatus;
    fundingTransactionId: string;
    fundingOutputIndex: number;
    fundingBlockDaaScore: bigint;
    fundingAcceptingBlockHash: string;
    covenantIdHex: string;
    activationOutputs: Prisma.InputJsonValue;
  };
  projectionCreate: ReturnType<typeof buildGiveawayV6ProjectionCreateData>;
};

export class GiveawayV6BootstrapError extends Error {
  readonly code: "INVALID_BOOTSTRAP" | "INVALID_FUNDING" | "STALE_BOOTSTRAP";

  constructor(code: "INVALID_BOOTSTRAP" | "INVALID_FUNDING" | "STALE_BOOTSTRAP", message: string) {
    super(message);
    this.name = "GiveawayV6BootstrapError";
    this.code = code;
  }
}

/**
 * Validates a compiler-produced V6 bootstrap before a funding QR is exposed.
 * The returned record contains public scripts and commitments only.
 */
export function buildGiveawayV6BootstrapCreateData(input: {
  network: Network;
  config: GiveawayV6ReconstructionConfig;
  familyTerms: GiveawayV6FamilyTerms;
  prizeRedeemScriptHex: string;
  shardTemplateRedeemScriptHex: string;
}) {
  const config = parseGiveawayV6ConfigJson(serializeGiveawayV6ConfigJson(input.config));
  const familyTerms = parseGiveawayV6FamilyTermsJson(
    serializeGiveawayV6FamilyTermsJson(input.familyTerms),
  );
  const prizeRedeemScriptHex = normalizeScript(input.prizeRedeemScriptHex, "Prize redeem script");
  const shardTemplateRedeemScriptHex = normalizeScript(
    input.shardTemplateRedeemScriptHex,
    "Shard template redeem script",
  );
  validateFamilyTerms(config, familyTerms);
  validateBootstrapScripts(config, familyTerms, prizeRedeemScriptHex, shardTemplateRedeemScriptHex);

  const expectedFundingSompi = checkedSum(
    familyTerms.prizeValueSompi,
    BigInt(config.shardCount) * familyTerms.shardValueSompi,
    familyTerms.activationFeeSompi,
  );
  const fundingScriptPublicKeyHex =
    giveawayV6PayToScriptHashScriptPublicKeyHex(prizeRedeemScriptHex);
  const fundingAddress = kaspaAddressFromScriptPublicKeyHex(
    fundingScriptPublicKeyHex,
    input.network === Network.MAINNET ? "mainnet" : "testnet-10",
  );

  return {
    network: input.network,
    status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
    compilerCommit: GIVEAWAY_V6_COMPILER_COMMIT,
    prizeSourceSha256: GIVEAWAY_V6_PRIZE_SOURCE_SHA256,
    shardSourceSha256: GIVEAWAY_V6_SHARD_SOURCE_SHA256,
    config: serializeGiveawayV6ConfigJson(config) as Prisma.InputJsonValue,
    familyTerms: serializeGiveawayV6FamilyTermsJson(familyTerms) as Prisma.InputJsonValue,
    prizeRedeemScriptHex,
    shardTemplateRedeemScriptHex,
    fundingScriptPublicKeyHex,
    fundingAddress,
    expectedFundingSompi,
  };
}

/**
 * Binds one exact confirmed ordinary funding output to its deterministic
 * KIP-20 genesis family. No transaction is signed or broadcast here.
 */
export function prepareGiveawayV6BootstrapBinding(input: {
  record: GiveawayV6BootstrapRecord;
  funding: GiveawayV6ConfirmedFunding;
}): PreparedGiveawayV6BootstrapBinding {
  const { record, funding } = input;
  if (record.status !== GiveawayV6BootstrapStatus.AWAITING_FUNDING) {
    throw new GiveawayV6BootstrapError("STALE_BOOTSTRAP", "Giveaway V6 funding is already bound.");
  }
  const config = parseGiveawayV6ConfigJson(record.config);
  const familyTerms = parseGiveawayV6FamilyTermsJson(record.familyTerms);
  const reviewed = buildGiveawayV6BootstrapCreateData({
    network: record.network,
    config,
    familyTerms,
    prizeRedeemScriptHex: record.prizeRedeemScriptHex,
    shardTemplateRedeemScriptHex: record.shardTemplateRedeemScriptHex,
  });
  assertStoredReview(record, reviewed);

  const transactionId = normalizeHash(funding.transactionId, "funding transaction ID");
  const acceptingBlockHash = normalizeHash(
    funding.acceptingBlockHash,
    "funding accepting block hash",
  );
  requireOutputIndex(funding.outputIndex, "funding output index");
  requireFundingU64(funding.blockDaaScore, "funding block DAA score");
  if (funding.covenantIdHex !== null) {
    throw new GiveawayV6BootstrapError(
      "INVALID_FUNDING",
      "Giveaway V6 funding must be an ordinary output without a covenant ID.",
    );
  }
  if (funding.amountSompi !== reviewed.expectedFundingSompi) {
    throw new GiveawayV6BootstrapError(
      "INVALID_FUNDING",
      "Confirmed funding amount does not match the reviewed Giveaway V6 total.",
    );
  }
  if (
    normalizeFundingScript(funding.scriptPublicKeyHex, "funding script public key") !==
    reviewed.fundingScriptPublicKeyHex
  ) {
    throw new GiveawayV6BootstrapError(
      "INVALID_FUNDING",
      "Confirmed funding output does not pay the reviewed Giveaway V6 script.",
    );
  }

  const genesisOutpoint = { transactionId, outputIndex: funding.outputIndex };
  const snapshot = reconstructGiveawayV6(config, []);
  const openPrizeRedeem = buildGiveawayV6PrizeRedeemScriptHex(record.prizeRedeemScriptHex, {
    phase: 1,
    frozenRootHex: ZERO_HASH,
    entryCount: 0,
  });
  const unboundOutputs = [
    {
      outputIndex: 0,
      amountSompi: familyTerms.prizeValueSompi,
      scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(openPrizeRedeem),
    },
    ...snapshot.shards.map((shard, index) => ({
      outputIndex: index + 1,
      amountSompi: familyTerms.shardValueSompi,
      scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(
        buildGiveawayV6ShardRedeemScriptHex(record.shardTemplateRedeemScriptHex, {
          shardIndex: shard.shardIndex,
          count: shard.finalizedEntryCount,
          entriesRootHex: shard.entriesRootHex,
          addressRootHex: shard.addressRootHex,
          pendingHashHex: ZERO_HASH,
        }),
      ),
    })),
  ];
  const covenantIdHex = deriveGiveawayV6GenesisCovenantIdHex(genesisOutpoint, unboundOutputs);
  const activationOutputs: GiveawayV6ActivationOutput[] = unboundOutputs.map((output) => ({
    ...output,
    covenant: { authorizingInput: 0, covenantIdHex },
  }));
  const family: GiveawayV6FamilyDescriptor = {
    genesisOutpoint,
    covenantIdHex,
    ...familyTerms,
  };
  const activationOutputsJson = activationOutputs.map(serializeActivationOutput);

  return {
    family,
    activationOutputs,
    bootstrapUpdate: {
      status: GiveawayV6BootstrapStatus.BOUND,
      fundingTransactionId: transactionId,
      fundingOutputIndex: funding.outputIndex,
      fundingBlockDaaScore: funding.blockDaaScore,
      fundingAcceptingBlockHash: acceptingBlockHash,
      covenantIdHex,
      activationOutputs: activationOutputsJson as Prisma.InputJsonValue,
    },
    projectionCreate: buildGiveawayV6ProjectionCreateData({
      network: record.network,
      anchorHash: acceptingBlockHash,
      config,
      family,
    }),
  };
}

/** Atomically binds funding and creates the first restart-safe chain projection. */
export async function persistGiveawayV6BootstrapBinding(
  prisma: PrismaClient,
  record: Pick<GiveawayV6BootstrapRecord, "id" | "giveawayId">,
  prepared: PreparedGiveawayV6BootstrapBinding,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.giveawayV6Bootstrap.updateMany({
      data: prepared.bootstrapUpdate,
      where: {
        id: record.id,
        giveawayId: record.giveawayId,
        status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
      },
    });
    if (updated.count !== 1) {
      throw new GiveawayV6BootstrapError(
        "STALE_BOOTSTRAP",
        "A newer Giveaway V6 funding binding already exists.",
      );
    }
    await transaction.giveawayV6Projection.create({
      data: { giveawayId: record.giveawayId, ...prepared.projectionCreate },
    });
  });
}

function validateFamilyTerms(
  config: GiveawayV6ReconstructionConfig,
  terms: GiveawayV6FamilyTerms,
): void {
  const maximumRegistrationSpend = BigInt(config.maxEntriesPerShard) * terms.entryFeeSompi;
  requireU64(maximumRegistrationSpend, "maximum shard registration spend");
  if (terms.shardValueSompi <= maximumRegistrationSpend) {
    invalidBootstrap("Shard reserve must remain positive at the configured participant cap.");
  }
  const remainingReserve =
    BigInt(config.shardCount) * (terms.shardValueSompi - maximumRegistrationSpend);
  requireU64(remainingReserve, "minimum remaining execution reserve");
  if (
    remainingReserve <= terms.freezeFeeSompi + terms.drawFeeSompi ||
    remainingReserve <= terms.freezeFeeSompi + terms.returnFeeSompi
  ) {
    invalidBootstrap("Execution reserve cannot cover the committed terminal transaction fees.");
  }
}

function validateBootstrapScripts(
  config: GiveawayV6ReconstructionConfig,
  terms: GiveawayV6FamilyTerms,
  prizeRedeemScriptHex: string,
  shardTemplateRedeemScriptHex: string,
): void {
  if (giveawayV6TemplateHashHex("prize", prizeRedeemScriptHex) !== terms.prizeTemplateHashHex) {
    invalidBootstrap("Prize redeem script does not match the reviewed template hash.");
  }
  if (
    giveawayV6TemplateHashHex("shard", shardTemplateRedeemScriptHex) !== terms.shardTemplateHashHex
  ) {
    invalidBootstrap("Shard redeem script does not match the reviewed template hash.");
  }
  const prizeState = readGiveawayV6PrizeState(prizeRedeemScriptHex);
  if (
    prizeState.phase !== 0 ||
    prizeState.entryCount !== 0 ||
    prizeState.frozenRootHex !== ZERO_HASH
  ) {
    invalidBootstrap("Prize bootstrap must contain the canonical unopened state.");
  }
  const expected = reconstructGiveawayV6(config, []).shards[0]!;
  const shardState = readGiveawayV6ShardState(shardTemplateRedeemScriptHex);
  if (
    shardState.shardIndex !== 0 ||
    shardState.count !== 0 ||
    shardState.entriesRootHex !== expected.entriesRootHex ||
    shardState.addressRootHex !== expected.addressRootHex ||
    shardState.pendingHashHex !== ZERO_HASH
  ) {
    invalidBootstrap("Shard template must contain the canonical empty shard-zero state.");
  }
}

function assertStoredReview(
  record: GiveawayV6BootstrapRecord,
  reviewed: ReturnType<typeof buildGiveawayV6BootstrapCreateData>,
): void {
  if (
    record.compilerCommit !== reviewed.compilerCommit ||
    record.prizeSourceSha256 !== reviewed.prizeSourceSha256 ||
    record.shardSourceSha256 !== reviewed.shardSourceSha256 ||
    record.fundingScriptPublicKeyHex !== reviewed.fundingScriptPublicKeyHex ||
    record.fundingAddress !== reviewed.fundingAddress ||
    record.expectedFundingSompi !== reviewed.expectedFundingSompi
  ) {
    invalidBootstrap("Stored Giveaway V6 bootstrap disagrees with its reviewed artifacts.");
  }
}

function serializeActivationOutput(
  output: GiveawayV6ActivationOutput,
): GiveawayV6ActivationOutputJson {
  return { ...output, amountSompi: output.amountSompi.toString() };
}

function checkedSum(...values: readonly bigint[]): bigint {
  const total = values.reduce((sum, value) => sum + value, 0n);
  requireU64(total, "Giveaway V6 funding total");
  return total;
}

function requireU64(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
    invalidBootstrap(`${label} must fit uint64.`);
  }
}

function requireOutputIndex(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new GiveawayV6BootstrapError("INVALID_FUNDING", `${label} must be a uint32.`);
  }
}

function requireFundingU64(value: bigint, label: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
    throw new GiveawayV6BootstrapError("INVALID_FUNDING", `${label} must fit uint64.`);
  }
}

function normalizeHash(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!HASH_PATTERN.test(normalized)) {
    throw new GiveawayV6BootstrapError("INVALID_FUNDING", `${label} must be 32-byte hex.`);
  }
  return normalized;
}

function normalizeScript(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!SCRIPT_PATTERN.test(normalized) || normalized.length < 4 || normalized.length > 500_000) {
    invalidBootstrap(`${label} must be bounded even-length hexadecimal.`);
  }
  return normalized;
}

function normalizeFundingScript(value: string, label: string): string {
  try {
    return normalizeScript(value, label);
  } catch {
    throw new GiveawayV6BootstrapError(
      "INVALID_FUNDING",
      `${label} must be bounded even-length hexadecimal.`,
    );
  }
}

function invalidBootstrap(message: string): never {
  throw new GiveawayV6BootstrapError("INVALID_BOOTSTRAP", message);
}
