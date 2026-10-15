import type { Network, PrismaClient } from "@kaspa-actions/db";

import { isPrismaUniqueConstraintError } from "./prisma-errors";
import {
  deriveGiveawayV6SlotTerms,
  GIVEAWAY_V6_SLOT_CUTOFF_MINUTES,
  type GiveawayV6SlotTerms,
} from "./giveaway-v6-slots";

const DAA_PER_SECOND = 10n;
const CUTOFF_DAA = BigInt(GIVEAWAY_V6_SLOT_CUTOFF_MINUTES * 60) * DAA_PER_SECOND;

export class GiveawayV6SlotClosedError extends Error {
  constructor() {
    super(
      `On the chain, this draw time is already less than ${GIVEAWAY_V6_SLOT_CUTOFF_MINUTES} minutes away. Pick a later one.`,
    );
    this.name = "GiveawayV6SlotClosedError";
  }
}

type SlotStore = Pick<PrismaClient, "giveawayDrawSlot">;

/**
 * Returns the terms every Giveaway of this slot commits, fixing them on first
 * use.
 *
 * The first creation for a slot projects its time onto the chain counters and
 * stores the result; every later creation reuses that row verbatim. That is
 * what lets all Giveaways of a slot share one entropy proof. Two creations
 * racing for a new slot both try to insert, the unique index lets one win,
 * and the loser reads the winner's terms instead of its own.
 *
 * The wall-clock cutoff is checked by the caller. This adds the chain's view:
 * if blocks ran ahead of the clock, a reused slot can already be too close on
 * the chain even though the clock says otherwise, and funding would land too
 * late to open entries.
 */
export async function resolveGiveawayV6DrawSlot(
  store: SlotStore,
  input: {
    network: Network;
    startsAt: Date;
    chain: { blueScore: bigint; daa: bigint };
    now: Date;
  },
): Promise<GiveawayV6SlotTerms> {
  const where = { network_startsAt: { network: input.network, startsAt: input.startsAt } };
  let slot = await store.giveawayDrawSlot.findUnique({ where });
  if (!slot) {
    const terms = deriveGiveawayV6SlotTerms(input);
    try {
      slot = await store.giveawayDrawSlot.create({
        data: {
          network: input.network,
          startsAt: input.startsAt,
          ...terms,
          anchorDaa: input.chain.daa,
          anchorBlueScore: input.chain.blueScore,
          anchoredAt: input.now,
        },
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      slot = await store.giveawayDrawSlot.findUnique({ where });
      if (!slot) throw error;
    }
  }
  if (slot.closesAtDaa - input.chain.daa < CUTOFF_DAA) {
    throw new GiveawayV6SlotClosedError();
  }
  return {
    closesAtDaa: slot.closesAtDaa,
    entropyTargetBlueScore: slot.entropyTargetBlueScore,
    returnAtDaa: slot.returnAtDaa,
  };
}
