import { describe, expect, it } from "vitest";

import {
  checkGiveawayV6Slot,
  deriveGiveawayV6SlotTerms,
  describeGiveawayV6SlotOption,
  formatGiveawayV6Remaining,
  formatGiveawayV6SlotLocal,
  formatGiveawayV6SlotUtc,
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

  it("labels a slot in the viewer's zone next to its UTC time", () => {
    const now = at("2026-10-15T15:48:00.000Z");
    const berlin = { locale: "de-DE", timeZone: "Europe/Berlin" };

    expect(describeGiveawayV6SlotOption(at("2026-10-15T18:00:00.000Z"), now, berlin)).toBe(
      "Today 20:00 (18:00 UTC) · in 2 h 12 min",
    );
    expect(
      formatGiveawayV6SlotLocal(
        at("2026-10-15T00:00:00.000Z"),
        at("2026-10-14T20:00:00.000Z"),
        berlin,
      ),
    ).toBe("Tomorrow 2:00");
    expect(
      formatGiveawayV6SlotLocal(at("2026-10-16T00:00:00.000Z"), now, {
        locale: "en-US",
        timeZone: "America/New_York",
      }),
    ).toBe("Today 8:00 PM");
  });

  it("counts down in whole minutes", () => {
    const slot = at("2026-10-15T18:00:00.000Z");
    expect(formatGiveawayV6Remaining(slot, at("2026-10-15T17:15:30.000Z"))).toBe("in 44 min");
    expect(formatGiveawayV6Remaining(slot, at("2026-10-15T12:00:00.000Z"))).toBe("in 6 h");
    expect(formatGiveawayV6SlotUtc(at("2026-10-16T06:00:00.000Z"))).toBe("06:00 UTC");
  });
});
