import {
  GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
  GIVEAWAY_V6_DRAW_COMPUTE_BUDGET,
  GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET,
  GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET,
  GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
  GIVEAWAY_V6_RETURN_COMPUTE_BUDGET,
} from "@kaspa-actions/kaspa-indexer";
import { estimatePostToccataFeeMass, type PostToccataTransactionShape } from "@kaspa-actions/kaspa";

import type { GiveawayV6TransitionFees } from "./giveaway-v6-budget";

/** OP_BLAKE2B <32 bytes> OP_EQUAL. */
const PAY_TO_SCRIPT_HASH_BYTES = 35;
/** The longest standard payout script a participant can register. */
const MAX_PAYOUT_SCRIPT_BYTES = 35;
const ADDRESS_TREE_DEPTH = 256;

/*
 * Witness bytes beyond the scripts and Merkle siblings, measured on the
 * Mainnet one-shard canary of 2026-10-17. With them this model reproduces
 * that Giveaway's activation, registration and freeze masses exactly and its
 * draw within a dozen grams; the tests pin those values.
 */
const ACTIVATION_WITNESS_OFFSET = -105;
const REGISTRATION_WITNESS_OVERHEAD = 52;
const FREEZE_PRIZE_WITNESS_OVERHEAD = 11;
const FREEZE_SHARD_WITNESS_OVERHEAD = 8;
const DRAW_WITNESS_OVERHEAD = 649;
const DRAW_WITNESS_PER_EXTRA_SHARD = 72;
const RETURN_WITNESS_OVERHEAD = 8;

/** Fees must clear the modelled minimum by this much; the table keeps 5%. */
const REQUIRED_HEADROOM_PERCENT = 2n;

export type GiveawayV6FeeShape = {
  prizeScriptBytes: number;
  shardScriptBytes: number;
  shardCount: number;
  treeDepth: number;
};

type Transition = "activation" | "entry" | "freeze" | "draw" | "return";

function covenantOutputs(count: number) {
  return Array.from({ length: count }, () => ({
    covenant: true,
    scriptPublicKeyBytes: PAY_TO_SCRIPT_HASH_BYTES,
  }));
}

/** The worst-case transaction of each fixed-fee transition of one Giveaway. */
export function giveawayV6TransitionShapes(
  shape: GiveawayV6FeeShape,
): Record<Transition, PostToccataTransactionShape> {
  const { prizeScriptBytes: prize, shardScriptBytes: shard, shardCount, treeDepth } = shape;
  const entrySiblingBytes = 32 * treeDepth;
  return {
    activation: {
      inputs: [
        {
          computeBudget: GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
          signatureScriptBytes: prize + shard + ACTIVATION_WITNESS_OFFSET,
        },
      ],
      outputs: covenantOutputs(shardCount + 1),
    },
    entry: {
      inputs: [
        {
          computeBudget: GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
          signatureScriptBytes:
            shard + entrySiblingBytes + 32 * ADDRESS_TREE_DEPTH + REGISTRATION_WITNESS_OVERHEAD,
        },
      ],
      outputs: covenantOutputs(1),
    },
    freeze: {
      inputs: [
        {
          computeBudget: GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET,
          signatureScriptBytes:
            prize + entrySiblingBytes * shardCount + FREEZE_PRIZE_WITNESS_OVERHEAD,
        },
        ...Array.from({ length: shardCount }, () => ({
          computeBudget: GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET,
          signatureScriptBytes: shard + FREEZE_SHARD_WITNESS_OVERHEAD,
        })),
      ],
      outputs: covenantOutputs(1),
    },
    draw: {
      inputs: [
        {
          computeBudget: GIVEAWAY_V6_DRAW_COMPUTE_BUDGET,
          signatureScriptBytes:
            prize + DRAW_WITNESS_OVERHEAD + DRAW_WITNESS_PER_EXTRA_SHARD * (shardCount - 1),
        },
      ],
      outputs: [
        { covenant: false, scriptPublicKeyBytes: MAX_PAYOUT_SCRIPT_BYTES },
        { covenant: false, scriptPublicKeyBytes: MAX_PAYOUT_SCRIPT_BYTES },
      ],
    },
    return: {
      inputs: [
        {
          computeBudget: GIVEAWAY_V6_RETURN_COMPUTE_BUDGET,
          signatureScriptBytes: prize + RETURN_WITNESS_OVERHEAD,
        },
      ],
      outputs: [{ covenant: false, scriptPublicKeyBytes: MAX_PAYOUT_SCRIPT_BYTES }],
    },
  };
}

export function giveawayV6MinimumFees(shape: GiveawayV6FeeShape): Record<Transition, bigint> {
  const shapes = giveawayV6TransitionShapes(shape);
  return {
    activation: estimatePostToccataFeeMass(shapes.activation).minimumFeeSompi,
    entry: estimatePostToccataFeeMass(shapes.entry).minimumFeeSompi,
    freeze: estimatePostToccataFeeMass(shapes.freeze).minimumFeeSompi,
    draw: estimatePostToccataFeeMass(shapes.draw).minimumFeeSompi,
    return: estimatePostToccataFeeMass(shapes.return).minimumFeeSompi,
  };
}

export class GiveawayV6FeeCoverageError extends Error {
  constructor(readonly transitions: readonly Transition[]) {
    super(`Giveaway V6 fees no longer cover: ${transitions.join(", ")}.`);
    this.name = "GiveawayV6FeeCoverageError";
  }
}

/**
 * Refuses to create a Giveaway whose committed fees would not relay. A
 * covenant fee cannot be raised after funding, so a shortfall found at
 * settlement would strand the prize until the return deadline, or for good
 * if the return fee is short too.
 */
export function assertGiveawayV6FeesCoverRelayMinimum(
  shape: GiveawayV6FeeShape,
  fees: GiveawayV6TransitionFees,
): void {
  const minimum = giveawayV6MinimumFees(shape);
  const committed: Record<Transition, bigint> = {
    activation: fees.activationFeeSompi,
    entry: fees.entryFeeSompi,
    freeze: fees.freezeFeeSompi,
    draw: fees.drawFeeSompi,
    return: fees.returnFeeSompi,
  };
  const short = (Object.keys(minimum) as Transition[]).filter(
    (transition) =>
      committed[transition] * 100n < minimum[transition] * (100n + REQUIRED_HEADROOM_PERCENT),
  );
  if (short.length > 0) throw new GiveawayV6FeeCoverageError(short);
}
