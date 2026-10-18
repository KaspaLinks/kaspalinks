/**
 * Compute budgets declared by each keyless Giveaway V6 transition. A declared
 * budget counts toward compute mass in full, so these also fix the fees the
 * covenant must commit; creation checks those fees through the same values.
 */

// Exact engine budgets measured against the pinned V6 compiler output.
export const GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET = 147;
export const GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET = 457;

// These deliberately exceed the measured script units.
export const GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET = 1_200;
export const GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET = 100;
export const GIVEAWAY_V6_DRAW_COMPUTE_BUDGET = 1_650;
export const GIVEAWAY_V6_RETURN_COMPUTE_BUDGET = 50;
