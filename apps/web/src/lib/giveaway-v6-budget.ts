export const GIVEAWAY_V6_PARTICIPANT_CAPS = [8, 16, 32] as const;
export type GiveawayV6ParticipantCap = (typeof GIVEAWAY_V6_PARTICIPANT_CAPS)[number];

export const GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD = 8;
export const GIVEAWAY_V6_ENTRY_FEE_SOMPI = 10_000_000n;

export type GiveawayV6TransitionFees = {
  activationFeeSompi: bigint;
  entryFeeSompi: bigint;
  freezeFeeSompi: bigint;
  drawFeeSompi: bigint;
  returnFeeSompi: bigint;
};

/**
 * Fees committed into the covenant, by shard count. Each is the relay minimum
 * of its worst-case transaction plus at least 5%, rounded up to 0.01 KAS. The
 * masses come from the model in giveaway-v6-fee-check.ts, which reproduces the
 * Mainnet masses of a one-shard Giveaway exactly; creation re-checks every fee
 * against the compiled scripts. A fee cannot change after funding, so a value
 * here must never undercut its transaction.
 */
const GIVEAWAY_V6_FEES_BY_SHARD_COUNT: Readonly<Record<1 | 2 | 4, GiveawayV6TransitionFees>> = {
  1: {
    activationFeeSompi: 9_000_000n,
    entryFeeSompi: GIVEAWAY_V6_ENTRY_FEE_SOMPI,
    freezeFeeSompi: 19_000_000n,
    drawFeeSompi: 19_000_000n,
    returnFeeSompi: 2_000_000n,
  },
  2: {
    activationFeeSompi: 10_000_000n,
    entryFeeSompi: GIVEAWAY_V6_ENTRY_FEE_SOMPI,
    freezeFeeSompi: 24_000_000n,
    drawFeeSompi: 19_000_000n,
    returnFeeSompi: 2_000_000n,
  },
  4: {
    activationFeeSompi: 11_000_000n,
    entryFeeSompi: GIVEAWAY_V6_ENTRY_FEE_SOMPI,
    freezeFeeSompi: 34_000_000n,
    drawFeeSompi: 19_000_000n,
    returnFeeSompi: 3_000_000n,
  },
};

export function giveawayV6TransitionFees(shardCount: number): GiveawayV6TransitionFees {
  if (shardCount !== 1 && shardCount !== 2 && shardCount !== 4) {
    throw new Error("Unsupported Giveaway V6 shard count.");
  }
  return GIVEAWAY_V6_FEES_BY_SHARD_COUNT[shardCount];
}

// The reviewed 32-person profile leaves 0.84 KAS after every possible entry.
// Preserve that same terminal reserve for the smaller one- and two-shard profiles.
const TERMINAL_RESERVE_SOMPI = 84_000_000n;

export function isGiveawayV6ParticipantCap(value: number): value is GiveawayV6ParticipantCap {
  return GIVEAWAY_V6_PARTICIPANT_CAPS.some((cap) => cap === value);
}

export function buildGiveawayV6Budget(
  prizeValueSompi: bigint,
  participantCap: GiveawayV6ParticipantCap,
) {
  if (prizeValueSompi <= 0n) throw new Error("Giveaway V6 prize must be positive.");
  const shardCount = participantCap / GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD;
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 4) {
    throw new Error("Unsupported Giveaway V6 participant limit.");
  }
  const shardCountBigInt = BigInt(shardCount);
  if (TERMINAL_RESERVE_SOMPI % shardCountBigInt !== 0n) {
    throw new Error("Giveaway V6 terminal reserve cannot be split across its shards.");
  }

  const fees = giveawayV6TransitionFees(shardCount);
  const maximumEntryFeesSompi = BigInt(participantCap) * fees.entryFeeSompi;
  const shardValueSompi =
    BigInt(GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD) * fees.entryFeeSompi +
    TERMINAL_RESERVE_SOMPI / shardCountBigInt;
  const executionReserveSompi = shardCountBigInt * shardValueSompi;
  const settlementFeesSompi = fees.freezeFeeSompi + fees.drawFeeSompi;
  const maximumNetworkCostSompi =
    fees.activationFeeSompi + maximumEntryFeesSompi + settlementFeesSompi;
  const minimumReturnSompi = executionReserveSompi - maximumEntryFeesSompi - settlementFeesSompi;
  const expectedFundingSompi = prizeValueSompi + executionReserveSompi + fees.activationFeeSompi;

  if (minimumReturnSompi <= 0n) {
    throw new Error("Giveaway V6 execution reserve cannot cover terminal settlement.");
  }

  return {
    activationFeeSompi: fees.activationFeeSompi,
    drawFeeSompi: fees.drawFeeSompi,
    entryFeeSompi: fees.entryFeeSompi,
    executionReserveSompi,
    expectedFundingSompi,
    freezeFeeSompi: fees.freezeFeeSompi,
    maximumEntryFeesSompi,
    maximumNetworkCostSompi,
    minimumReturnSompi,
    participantCap,
    returnFeeSompi: fees.returnFeeSompi,
    settlementFeesSompi,
    shardCount,
    shardValueSompi,
  };
}
