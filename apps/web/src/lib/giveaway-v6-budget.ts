export const GIVEAWAY_V6_PARTICIPANT_CAPS = [8, 16, 32] as const;
export type GiveawayV6ParticipantCap = (typeof GIVEAWAY_V6_PARTICIPANT_CAPS)[number];

export const GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD = 8;
export const GIVEAWAY_V6_ENTRY_FEE_SOMPI = 10_000_000n;
export const GIVEAWAY_V6_ACTIVATION_FEE_SOMPI = 10_000_000n;
export const GIVEAWAY_V6_FREEZE_FEE_SOMPI = 33_000_000n;
export const GIVEAWAY_V6_DRAW_FEE_SOMPI = 18_000_000n;
export const GIVEAWAY_V6_RETURN_FEE_SOMPI = 2_000_000n;

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

  const maximumEntryFeesSompi = BigInt(participantCap) * GIVEAWAY_V6_ENTRY_FEE_SOMPI;
  const shardValueSompi =
    BigInt(GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD) * GIVEAWAY_V6_ENTRY_FEE_SOMPI +
    TERMINAL_RESERVE_SOMPI / shardCountBigInt;
  const executionReserveSompi = shardCountBigInt * shardValueSompi;
  const settlementFeesSompi = GIVEAWAY_V6_FREEZE_FEE_SOMPI + GIVEAWAY_V6_DRAW_FEE_SOMPI;
  const maximumNetworkCostSompi =
    GIVEAWAY_V6_ACTIVATION_FEE_SOMPI + maximumEntryFeesSompi + settlementFeesSompi;
  const minimumReturnSompi = executionReserveSompi - maximumEntryFeesSompi - settlementFeesSompi;
  const expectedFundingSompi =
    prizeValueSompi + executionReserveSompi + GIVEAWAY_V6_ACTIVATION_FEE_SOMPI;

  if (minimumReturnSompi <= 0n) {
    throw new Error("Giveaway V6 execution reserve cannot cover terminal settlement.");
  }

  return {
    activationFeeSompi: GIVEAWAY_V6_ACTIVATION_FEE_SOMPI,
    drawFeeSompi: GIVEAWAY_V6_DRAW_FEE_SOMPI,
    entryFeeSompi: GIVEAWAY_V6_ENTRY_FEE_SOMPI,
    executionReserveSompi,
    expectedFundingSompi,
    freezeFeeSompi: GIVEAWAY_V6_FREEZE_FEE_SOMPI,
    maximumEntryFeesSompi,
    maximumNetworkCostSompi,
    minimumReturnSompi,
    participantCap,
    returnFeeSompi: GIVEAWAY_V6_RETURN_FEE_SOMPI,
    settlementFeesSompi,
    shardCount,
    shardValueSompi,
  };
}
