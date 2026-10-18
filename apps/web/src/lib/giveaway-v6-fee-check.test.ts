import { estimatePostToccataFeeMass } from "@kaspa-actions/kaspa";
import { describe, expect, it } from "vitest";

import { giveawayV6TransitionFees } from "./giveaway-v6-budget";
import {
  assertGiveawayV6FeesCoverRelayMinimum,
  GiveawayV6FeeCoverageError,
  giveawayV6MinimumFees,
  giveawayV6TransitionShapes,
} from "./giveaway-v6-fee-check";

const SHARD_SCRIPT_BYTES = 37_158;
// Compiled prize sizes with production terms; the shard script does not
// depend on the shard count.
const PRIZE_SCRIPT_BYTES = { 1: 4_993, 2: 6_868, 4: 10_618 } as const;

describe("Giveaway V6 fee model", () => {
  it("reproduces the masses of the Mainnet one-shard canary", () => {
    const shapes = giveawayV6TransitionShapes({
      prizeScriptBytes: 4_993,
      shardScriptBytes: SHARD_SCRIPT_BYTES,
      shardCount: 1,
      treeDepth: 10,
    });
    // Compute masses reported for bf9c…, 13f9…, ea54… and 3b55… on Mainnet.
    const chain = { activation: 57_808, entry: 92_026, freeze: 173_149, draw: 171_614 };
    for (const [transition, mass] of Object.entries(chain)) {
      const modelled = estimatePostToccataFeeMass(shapes[transition as keyof typeof chain]);
      // Never below the chain; above it only by the longest payout script.
      expect(Number(modelled.computeMass)).toBeGreaterThanOrEqual(mass);
      expect(Number(modelled.computeMass) - mass).toBeLessThanOrEqual(30);
    }
    // The activation is priced by its size, not its compute.
    expect(estimatePostToccataFeeMass(shapes.activation).feeMass).toBe(84_736n);
  });

  it("reproduces the return of the first Mainnet canary", () => {
    const shapes = giveawayV6TransitionShapes({
      prizeScriptBytes: 5_030,
      shardScriptBytes: SHARD_SCRIPT_BYTES,
      shardCount: 1,
      treeDepth: 10,
    });
    // 9a68…: one input, one 34-byte output; the model assumes 35 bytes.
    expect(estimatePostToccataFeeMass(shapes.return).computeMass).toBe(10_598n + 11n);
  });

  it.each([1, 2, 4] as const)("keeps at least 5%% headroom on every %i-shard fee", (shardCount) => {
    const minimum = giveawayV6MinimumFees({
      prizeScriptBytes: PRIZE_SCRIPT_BYTES[shardCount],
      shardScriptBytes: SHARD_SCRIPT_BYTES,
      shardCount,
      treeDepth: 10,
    });
    const fees = giveawayV6TransitionFees(shardCount);
    const committed = {
      activation: fees.activationFeeSompi,
      entry: fees.entryFeeSompi,
      freeze: fees.freezeFeeSompi,
      draw: fees.drawFeeSompi,
      return: fees.returnFeeSompi,
    };
    for (const [transition, fee] of Object.entries(committed)) {
      expect(fee * 100n).toBeGreaterThanOrEqual(minimum[transition as keyof typeof minimum] * 105n);
    }
  });

  it("refuses fees that would not relay", () => {
    const shape = {
      prizeScriptBytes: PRIZE_SCRIPT_BYTES[4],
      shardScriptBytes: SHARD_SCRIPT_BYTES,
      shardCount: 4,
      treeDepth: 10,
    };
    // The single-shard freeze fee cannot carry a four-shard freeze.
    const fees = { ...giveawayV6TransitionFees(4), freezeFeeSompi: 19_000_000n };

    expect(() => assertGiveawayV6FeesCoverRelayMinimum(shape, fees)).toThrow(
      GiveawayV6FeeCoverageError,
    );
    expect(() => assertGiveawayV6FeesCoverRelayMinimum(shape, fees)).toThrow(/freeze/u);
    expect(() =>
      assertGiveawayV6FeesCoverRelayMinimum(shape, giveawayV6TransitionFees(4)),
    ).not.toThrow();
  });
});
