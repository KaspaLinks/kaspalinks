import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { findPrototype, findV6 } = vi.hoisted(() => ({
  findPrototype: vi.fn(),
  findV6: vi.fn(),
}));
vi.mock("@kaspa-actions/db", () => ({
  prisma: {
    covenantPrototype: { findUnique: findPrototype },
    giveaway: { findUnique: findV6 },
  },
}));
import { giveawayMetadata, readGiveawayPreview } from "./preview";
const id = "cmf12345678901234567890123";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "true");
  findV6.mockResolvedValue(null);
  findPrototype.mockResolvedValue({
    publicTitle: "Community gift",
    manifest: { prizeSompi: "20000000", creatorPublicKeyHex: "private-metadata-not-for-preview" },
    creator: { username: "example" },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("public covenant giveaway previews", () => {
  it("identifies the giveaway and exact prize in OG and Twitter metadata", async () => {
    const m = await giveawayMetadata(id);
    expect(m.openGraph).toMatchObject({
      title: "Kaspa Giveaway · 0.2 KAS | Community gift",
      url: `/giveaways/${id}`,
      images: [{ url: `/giveaways/${id}/opengraph-image`, width: 1200, height: 630 }],
    });
    expect(m.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Kaspa Giveaway · 0.2 KAS | Community gift",
      images: [`/giveaways/${id}/opengraph-image`],
    });
    expect(JSON.stringify(m)).not.toContain("private-metadata");
    expect(m.description).not.toMatch(/funded|enter now/i);
  });
  it("returns only public image fields", async () => {
    expect(await readGiveawayPreview(id)).toEqual({
      title: "Community gift",
      username: "example",
      amount: "0.2 KAS",
    });
  });
  it("does not query invalid IDs or disabled previews", async () => {
    expect(await readGiveawayPreview("../private")).toBeNull();
    vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "false");
    expect(await readGiveawayPreview(id)).toBeNull();
    expect(findPrototype).not.toHaveBeenCalled();
  });
  it.each([null, { publicTitle: null }, { publicTitle: "Bad", manifest: { prizeSompi: "1e8" } }])(
    "hides private, missing or malformed giveaways",
    async (row) => {
      findPrototype.mockResolvedValue(row);
      expect(await readGiveawayPreview(id)).toBeNull();
      expect(await giveawayMetadata(id)).toMatchObject({
        title: "Giveaway unavailable",
        robots: { index: false },
      });
    },
  );

  it("uses the public V6 giveaway identity without reading a covenant manifest", async () => {
    findV6.mockResolvedValue({
      amountSompi: 50_000_000n,
      title: "SilverScript draw",
      creator: { username: "example" },
      v6Projection: {
        family: {
          genesisOutpoint: { transactionId: "01".repeat(32), outputIndex: 0 },
          covenantIdHex: "02".repeat(32),
          prizeTemplateHashHex: "03".repeat(32),
          shardTemplateHashHex: "04".repeat(32),
          prizeValueSompi: "50000000",
          shardValueSompi: "100000",
          entryFeeSompi: "1000",
          activationFeeSompi: "1000",
          freezeFeeSompi: "1000",
          drawFeeSompi: "1000",
          returnFeeSompi: "1000",
        },
      },
    });

    expect(await readGiveawayPreview(id)).toEqual({
      title: "SilverScript draw",
      username: "example",
      amount: "0.5 KAS",
    });
    expect(findPrototype).not.toHaveBeenCalled();
  });

  it("fails closed when the public amount disagrees with the V6 covenant family", async () => {
    findV6.mockResolvedValue({
      amountSompi: 1n,
      title: "Changed amount",
      creator: { username: "example" },
      v6Projection: {
        family: {
          genesisOutpoint: { transactionId: "01".repeat(32), outputIndex: 0 },
          covenantIdHex: "02".repeat(32),
          prizeTemplateHashHex: "03".repeat(32),
          shardTemplateHashHex: "04".repeat(32),
          prizeValueSompi: "50000000",
          shardValueSompi: "100000",
          entryFeeSompi: "1000",
          activationFeeSompi: "1000",
          freezeFeeSompi: "1000",
          drawFeeSompi: "1000",
          returnFeeSompi: "1000",
        },
      },
    });

    expect(await readGiveawayPreview(id)).toBeNull();
  });
});
