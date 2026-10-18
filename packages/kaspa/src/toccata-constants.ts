export const TOCCATA_BATCH_MIN_OUTPUTS = 2;
export const TOCCATA_BATCH_MAX_SAFE_OUTPUTS = 8;
/**
 * Largest Claim Drop ever registered (10 links, created before the 8-link cap).
 * Such drops can be rebuilt for verification and refunded, never created.
 */
export const TOCCATA_BATCH_MAX_REGISTERED_OUTPUTS = 10;
/** Pre-Toccata P2SH push limit; new drops stay below it. Toccata allows 1,000,000 bytes. */
export const TOCCATA_P2SH_MAX_SCRIPT_ELEMENT_BYTES = 520;
