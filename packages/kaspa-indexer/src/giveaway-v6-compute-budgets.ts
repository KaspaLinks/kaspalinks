/**
 * Compute budgets declared by each keyless Giveaway V6 transition. A declared
 * budget counts toward compute mass in full, so these also fix the fees the
 * covenant must commit; creation checks those fees through the same values.
 */

// Exact engine budget measured against the pinned V6 compiler output.
export const GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET = 147;

// The first entry of a shard fits 457, but every later one also finalizes the
// pending entry: Mainnet rejected those at 4,587,4xx of 4,579,999 units. 470
// covers that with ~2.7% headroom and stays inside the committed entry fee.
export const GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET = 470;

// These deliberately exceed the measured script units.
export const GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET = 1_200;
export const GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET = 100;
export const GIVEAWAY_V6_DRAW_COMPUTE_BUDGET = 1_650;
export const GIVEAWAY_V6_RETURN_COMPUTE_BUDGET = 50;
