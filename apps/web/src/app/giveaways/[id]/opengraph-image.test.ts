import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), limit: vi.fn() }));
vi.mock("./preview", () => ({ readGiveawayPreview: mocks.read }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/client-ip", () => ({ extractClientIp: () => "test", hashClientIp: () => "hash" }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_QR: "test" },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      public image: React.ReactElement,
      public size: unknown,
    ) {}
  },
}));
Object.assign(globalThis, { React });
import GiveawayOpenGraphImage from "./opengraph-image";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockReturnValue({ allowed: true });
});
describe("giveaway image endpoint", () => {
  it("limits requests before querying the giveaway", async () => {
    const response = new Response("limited", { status: 429 });
    mocks.limit.mockReturnValue({ allowed: false, response });
    expect(await GiveawayOpenGraphImage({ params: Promise.resolve({ id: "id" }) })).toBe(response);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses private or unavailable giveaways", async () => {
    mocks.read.mockResolvedValue(null);
    await expect(GiveawayOpenGraphImage({ params: Promise.resolve({ id: "id" }) })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
  it("renders the public giveaway identity and prize", async () => {
    mocks.read.mockResolvedValue({
      title: "Community gift",
      username: "example",
      amount: "0.2 KAS",
    });
    const result = await GiveawayOpenGraphImage({ params: Promise.resolve({ id: "id" }) });
    expect(result).toMatchObject({
      size: { width: 1200, height: 630 },
      image: {
        props: {
          eyebrow: "Kaspa Giveaway",
          title: "Community gift",
          amountLabel: "0.2 KAS prize",
          handle: "example",
          typeLabel: "Giveaway",
        },
      },
    });
  });
});
