/**
 * Fixed draw slots for Giveaway V6.
 *
 * Giveaways end only at 00:00, 06:00, 12:00 and 18:00 UTC. The entropy proof
 * attests which block first crosses a target blue score and nothing
 * Giveaway-specific, so every Giveaway of one slot can share one proof. That
 * only works if they all commit the same target, which is why a slot's terms
 * are fixed once and reused (see `giveaway-v6-slot-store.ts`) rather than
 * derived from each creator's own moment.
 *
 * Pure functions only: the creation studio uses them in the browser to offer
 * the same slots the server will accept.
 */

export const GIVEAWAY_V6_SLOT_INTERVAL_HOURS = 6;
/** A slot stops being selectable this long before it, so funding can land. */
export const GIVEAWAY_V6_SLOT_CUTOFF_MINUTES = 30;
/**
 * Kaspa's pruned nodes keep about 30 hours of block data. Keeping activation
 * within 24 hours of the close lets any ordinary node replay a Giveaway's
 * whole lineage, which is what makes its entries independently verifiable.
 */
export const GIVEAWAY_V6_SLOT_HORIZON_HOURS = 24;
export const GIVEAWAY_V6_ENTROPY_DELAY_SECONDS = 60;
export const GIVEAWAY_V6_RETURN_DELAY_SECONDS = 24 * 60 * 60;

const DAA_PER_SECOND = 10n;
const INTERVAL_MS = GIVEAWAY_V6_SLOT_INTERVAL_HOURS * 60 * 60 * 1_000;
const CUTOFF_MS = GIVEAWAY_V6_SLOT_CUTOFF_MINUTES * 60 * 1_000;
const HORIZON_MS = GIVEAWAY_V6_SLOT_HORIZON_HOURS * 60 * 60 * 1_000;

export type GiveawayV6SlotCheck = "ok" | "not_a_slot" | "too_soon" | "too_far";

export type GiveawayV6SlotTerms = {
  closesAtDaa: bigint;
  entropyTargetBlueScore: bigint;
  returnAtDaa: bigint;
};

/**
 * Six-hour boundaries counted from the Unix epoch land on 00:00, 06:00, 12:00
 * and 18:00 UTC, because a day divides evenly into four of them.
 */
export function isGiveawayV6SlotBoundary(date: Date): boolean {
  const ms = date.getTime();
  return Number.isFinite(ms) && ms % INTERVAL_MS === 0;
}

/** Slots a new Giveaway can choose right now, earliest first. */
export function listGiveawayV6Slots(now: Date): Date[] {
  const earliest = now.getTime() + CUTOFF_MS;
  const latest = now.getTime() + HORIZON_MS;
  const slots: Date[] = [];
  for (let ms = Math.ceil(earliest / INTERVAL_MS) * INTERVAL_MS; ms <= latest; ms += INTERVAL_MS) {
    slots.push(new Date(ms));
  }
  return slots;
}

export function checkGiveawayV6Slot(startsAt: Date, now: Date): GiveawayV6SlotCheck {
  if (!isGiveawayV6SlotBoundary(startsAt)) return "not_a_slot";
  const remaining = startsAt.getTime() - now.getTime();
  if (remaining < CUTOFF_MS) return "too_soon";
  if (remaining > HORIZON_MS) return "too_far";
  return "ok";
}

export function describeGiveawayV6SlotCheck(check: Exclude<GiveawayV6SlotCheck, "ok">): string {
  switch (check) {
    case "not_a_slot":
      return "Giveaways end only at 00:00, 06:00, 12:00 or 18:00 UTC.";
    case "too_soon":
      return `New Giveaways for this draw time closed ${GIVEAWAY_V6_SLOT_CUTOFF_MINUTES} minutes before it. Pick a later one.`;
    case "too_far":
      return `Giveaways can end at most ${GIVEAWAY_V6_SLOT_HORIZON_HOURS} hours ahead.`;
  }
}

/**
 * Projects a slot's wall-clock time onto the chain's DAA and blue-score
 * counters, which advance about ten per second. The chain counts blocks, not
 * seconds, so the real close drifts from the nominal time by seconds or a few
 * minutes; the interface shows slots as approximate.
 */
export function deriveGiveawayV6SlotTerms(input: {
  startsAt: Date;
  chain: { blueScore: bigint; daa: bigint };
  now: Date;
}): GiveawayV6SlotTerms {
  const secondsUntil = Math.floor((input.startsAt.getTime() - input.now.getTime()) / 1_000);
  if (!Number.isSafeInteger(secondsUntil) || secondsUntil <= 0) {
    throw new Error("A draw slot must lie in the future.");
  }
  const offset = BigInt(secondsUntil) * DAA_PER_SECOND;
  const closesAtDaa = input.chain.daa + offset;
  return {
    closesAtDaa,
    entropyTargetBlueScore:
      input.chain.blueScore + offset + BigInt(GIVEAWAY_V6_ENTROPY_DELAY_SECONDS) * DAA_PER_SECOND,
    returnAtDaa: closesAtDaa + BigInt(GIVEAWAY_V6_RETURN_DELAY_SECONDS) * DAA_PER_SECOND,
  };
}
