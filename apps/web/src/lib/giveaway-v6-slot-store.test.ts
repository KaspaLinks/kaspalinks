import { describe, expect, it, vi } from "vitest";

import { GiveawayV6SlotClosedError, resolveGiveawayV6DrawSlot } from "./giveaway-v6-slot-store";

const input = {
  network: "MAINNET" as const,
  startsAt: new Date("2026-10-15T12:00:00.000Z"),
  chain: { daa: 536_000_000n, blueScore: 535_000_000n },
  now: new Date("2026-10-15T11:00:00.000Z"),
};

function store(overrides: { create?: unknown; findUnique?: unknown } = {}) {
  return {
    giveawayDrawSlot: {
      create: vi.fn(async ({ data }) => data),
      findUnique: vi.fn(async () => null),
      ...overrides,
    },
  } as unknown as Parameters<typeof resolveGiveawayV6DrawSlot>[0];
}

describe("Giveaway V6 draw slot store", () => {
  it("fixes a new slot with the chain position it was projected from", async () => {
    const slots = store();

    await expect(resolveGiveawayV6DrawSlot(slots, input)).resolves.toEqual({
      closesAtDaa: 536_036_000n,
      entropyTargetBlueScore: 535_036_600n,
      returnAtDaa: 536_900_000n,
    });
    expect(slots.giveawayDrawSlot.create).toHaveBeenCalledWith({
      data: {
        anchorBlueScore: 535_000_000n,
        anchorDaa: 536_000_000n,
        anchoredAt: input.now,
        closesAtDaa: 536_036_000n,
        entropyTargetBlueScore: 535_036_600n,
        network: "MAINNET",
        returnAtDaa: 536_900_000n,
        startsAt: input.startsAt,
      },
    });
  });

  it("does not hide database failures behind the race fallback", async () => {
    const failure = new Error("database unavailable");
    const slots = store({ create: vi.fn().mockRejectedValue(failure) });

    await expect(resolveGiveawayV6DrawSlot(slots, input)).rejects.toBe(failure);
    expect(slots.giveawayDrawSlot.findUnique).toHaveBeenCalledTimes(1);
  });

  it("accepts a slot exactly at the chain cutoff and refuses one block closer", async () => {
    const row = {
      closesAtDaa: 536_018_000n,
      entropyTargetBlueScore: 535_018_600n,
      returnAtDaa: 536_882_000n,
    };
    const slots = store({ findUnique: vi.fn().mockResolvedValue(row) });

    await expect(resolveGiveawayV6DrawSlot(slots, input)).resolves.toEqual(row);
    await expect(
      resolveGiveawayV6DrawSlot(slots, {
        ...input,
        chain: { daa: 536_000_001n, blueScore: 535_000_001n },
      }),
    ).rejects.toBeInstanceOf(GiveawayV6SlotClosedError);
  });
});
