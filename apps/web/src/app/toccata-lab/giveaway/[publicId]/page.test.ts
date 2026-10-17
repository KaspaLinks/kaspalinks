import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: { giveaway: { findUnique: mocks.findUnique } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/turnstile", () => ({ getGiveawayTurnstileClientConfig: () => ({}) }));
vi.mock("./GiveawayEntryClient", () => ({ GiveawayEntryClient: () => null }));

import GiveawayEntryPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  // The page relies on the automatic JSX runtime that Next.js configures.
  vi.stubGlobal("React", React);
});

describe("lab Giveaway page", () => {
  it("sends a SilverScript V6 Giveaway to its own public page", async () => {
    mocks.findUnique.mockResolvedValue({ drawProtocolVersion: 6 });

    await expect(
      GiveawayEntryPage({ params: Promise.resolve({ publicId: "cmvcu1lra071501m8dbarch14" }) }),
    ).rejects.toMatchObject({ url: "/giveaways/cmvcu1lra071501m8dbarch14" });
  });

  it("keeps rendering older prize-link Giveaways", async () => {
    mocks.findUnique.mockResolvedValue({ drawProtocolVersion: 2 });

    await expect(
      GiveawayEntryPage({ params: Promise.resolve({ publicId: "cmold" }) }),
    ).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
