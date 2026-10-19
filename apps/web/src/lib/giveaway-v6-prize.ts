// Giveaway V6 prizes: any amount from 0.2 KAS. The contract takes the prize as a
// parameter, so nothing depends on fixed tiers. The only upper bound is a sanity
// check against Kaspa's total supply; it is not a policy limit.

export const GIVEAWAY_V6_MIN_PRIZE_SOMPI = 20_000_000n;
/** Kaspa's maximum supply (about 28.7 billion KAS). */
export const KASPA_MAX_SUPPLY_SOMPI = 2_870_402_660_100_000_000n;

const SOMPI_PER_KAS = 100_000_000n;

export type GiveawayV6PrizeResult = { ok: false; reason: string } | { ok: true; sompi: bigint };

export function parseGiveawayV6Prize(value: string): GiveawayV6PrizeResult {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(normalized);
  if (!match) {
    return { ok: false, reason: "Enter the prize in KAS, with at most 8 decimal places." };
  }
  const sompi = BigInt(match[1]!) * SOMPI_PER_KAS + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (sompi < GIVEAWAY_V6_MIN_PRIZE_SOMPI) {
    return { ok: false, reason: "The prize must be at least 0.2 KAS." };
  }
  if (sompi > KASPA_MAX_SUPPLY_SOMPI) {
    return { ok: false, reason: "The prize is larger than all KAS that will ever exist." };
  }
  return { ok: true, sompi };
}

/** Canonical KAS string for a prize ("10", "0.25"), as stored and shown. */
export function formatGiveawayV6Prize(sompi: bigint): string {
  const whole = sompi / SOMPI_PER_KAS;
  const fraction = (sompi % SOMPI_PER_KAS).toString().padStart(8, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
