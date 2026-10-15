import { describe, expect, it } from "vitest";

import {
  checkGiveawayV6Slot,
  deriveGiveawayV6SlotTerms,
  isGiveawayV6SlotBoundary,
  listGiveawayV6Slots,
} from "./giveaway-v6-slots";

const at = (iso: string) => new Date(iso);

describe("Giveaway V6 draw slots", () => {
  it("recognizes only the four UTC slot times of a day", () => {
    for (const hour of ["00", "06", "12", "18"]) {
      expect(isGiveawayV6SlotBoundary(at(`2026-10-15T${hour}:00:00.000Z`))).toBe(true);
    }
    expect(isGiveawayV6SlotBoundary(at("2026-10-15T13:00:00.000Z"))).toBe(false);
    expect(isGiveawayV6SlotBoundary(at("2026-10-15T12:00:00.001Z"))).toBe(false);
    // Same instant written with an offset is still a slot.
    expect(isGiveawayV6SlotBoundary(at("2026-10-15T14:00:00+02:00"))).toBe(true);
    expect(isGiveawayV6SlotBoundary(new Date(Number.NaN))).toBe(false);
  });

  it("offers every slot from the cutoff up to 24 hours ahead", () => {
    expect(listGiveawayV6Slots(at("2026-10-15T11:00:00.000Z"))).toEqual([
      at("2026-10-15T12:00:00.000Z"),
      at("2026-10-15T18:00:00.000Z"),
      at("2026-10-16T00:00:00.000Z"),
      at("2026-10-16T06:00:00.000Z"),
    ]);
  });

  it("drops the next slot once fewer than 30 minutes remain", () => {
    expect(listGiveawayV6Slots(at("2026-10-15T11:30:00.000Z"))[0]).toEqual(
      at("2026-10-15T12:00:00.000Z"),
    );
    expect(listGiveawayV6Slots(at("2026-10-15T11:30:00.001Z"))[0]).toEqual(
      at("2026-10-15T18:00:00.000Z"),
    );
  });

  it("includes the slot exactly 24 hours ahead", () => {
    const slots = listGiveawayV6Slots(at("2026-10-15T12:00:00.000Z"));
    expect(slots.at(-1)).toEqual(at("2026-10-16T12:00:00.000Z"));
    expect(slots).toHaveLength(4);
  });

  it("checks a requested slot against the same window the list uses", () => {
    const now = at("2026-10-15T11:00:00.000Z");
    expect(checkGiveawayV6Slot(at("2026-10-15T12:00:00.000Z"), now)).toBe("ok");
    expect(checkGiveawayV6Slot(at("2026-10-15T12:30:00.000Z"), now)).toBe("not_a_slot");
    expect(checkGiveawayV6Slot(at("2026-10-15T06:00:00.000Z"), now)).toBe("too_soon");
    expect(checkGiveawayV6Slot(at("2026-10-16T12:00:00.000Z"), now)).toBe("too_far");
    for (const slot of listGiveawayV6Slots(now)) {
      expect(checkGiveawayV6Slot(slot, now)).toBe("ok");
    }
  });

  it("projects the slot onto the chain counters at ten per second", () => {
    expect(
      deriveGiveawayV6SlotTerms({
        startsAt: at("2026-10-15T12:00:00.000Z"),
        chain: { daa: 536_000_000n, blueScore: 535_000_000n },
        now: at("2026-10-15T11:00:00.000Z"),
      }),
    ).toEqual({
      closesAtDaa: 536_036_000n,
      entropyTargetBlueScore: 535_036_600n,
      returnAtDaa: 536_900_000n,
    });
  });

  it("refuses to project a slot that has already passed", () => {
    expect(() =>
      deriveGiveawayV6SlotTerms({
        startsAt: at("2026-10-15T12:00:00.000Z"),
        chain: { daa: 536_000_000n, blueScore: 535_000_000n },
        now: at("2026-10-15T12:00:00.000Z"),
      }),
    ).toThrow("future");
  });
});
