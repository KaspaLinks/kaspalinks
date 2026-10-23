import { beforeEach, describe, expect, it, vi } from "vitest";

import { createToccataClaimableAutoReturnScript } from "@/lib/toccata-lab";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  listUtxos: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { SYSTEM: "SYSTEM" },
  prisma: { claimableLink: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/claimable-onchain", () => ({ listClaimableFundingUtxos: mocks.listUtxos }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { CLAIMABLE_RETURN_FILE: "claimable.return-file" },
}));
vi.mock("@/lib/toccata-lab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toccata-lab")>()),
  isToccataLabEnabled: () => true,
}));

import { GET } from "./route";

const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const FUNDING_TX = "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309";
const script = createToccataClaimableAutoReturnScript({
  feeSompi: "200000",
  linkPublicKey: "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
});

function accountFreeLink() {
  return {
    amountSompi: 100_200_000n,
    feeSompi: 200_000n,
    fundingAddress: script.fundingAddress,
    fundingOutputIndex: null,
    fundingTxId: null,
    linkKey: "lab-free",
    redeemScriptHex: script.redeemScriptHex,
    refundLockTime: "500000000",
    returnAddress: RETURN_ADDRESS,
    scriptVersion: 2,
    status: "awaiting_funding",
  };
}

function get() {
  return GET(new Request("https://kaspalinks.test/api/claimable-links/lab-free/return-file"), {
    params: Promise.resolve({ linkKey: "lab-free" }),
  });
}

describe("GET /api/claimable-links/[linkKey]/return-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(accountFreeLink());
  });

  it("finds the funding payment of a link without an account on-chain", async () => {
    mocks.listUtxos.mockResolvedValue([
      { amountSompi: 30_000_000n, outputIndex: 1, transactionId: "2".repeat(64) },
      { amountSompi: 100_200_000n, outputIndex: 0, transactionId: FUNDING_TX },
    ]);

    const response = await get();
    const file = (await response.json()) as { fundingOutpoint: unknown; returnAddress: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("kaspa-links-return-lab-free");
    expect(file.fundingOutpoint).toEqual({ index: 0, transactionId: FUNDING_TX });
    expect(file.returnAddress).toBe(RETURN_ADDRESS);
  });

  it("has no file before the payment arrives", async () => {
    mocks.listUtxos.mockResolvedValue([]);

    expect((await get()).status).toBe(404);
  });
});
