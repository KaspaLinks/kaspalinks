import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockPrisma: {},
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));

import { GET, POST } from "./route";

const TRANSACTION_ID = "d".repeat(64);
const REFUND_LOCK_TIME = "500000000";
const SAFE_JSON = JSON.stringify({
  id: TRANSACTION_ID,
  inputs: [
    {
      computeBudget: 11,
      index: 0,
      sequence: "0",
      sigOpCount: 0,
      signatureScript: `41${"11".repeat(65)}00${`4c50${"ab".repeat(80)}`}`,
      transactionId: "a".repeat(64),
      utxo: { amount: "100000000" },
    },
  ],
  lockTime: REFUND_LOCK_TIME,
  outputs: [{ scriptPublicKey: `0000${"aa".repeat(34)}`, value: "99000000" }],
  subnetworkId: "0".repeat(40),
  version: 1,
});

function request() {
  return new Request("https://kaspalinks.com/api/toccata-lab/batch-refund", {
    body: JSON.stringify({
      expectedTransactionId: TRANSACTION_ID,
      refundLockTime: REFUND_LOCK_TIME,
      transactionSafeJson: SAFE_JSON,
    }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.30" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/batch-refund", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetRateLimits();
  });

  it("is disabled unless the separate batch lab flag is enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    expect((await POST(request())).status).toBe(403);
  });

  it("relays a signed expired batch refund through the protected path", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              networkName: "kaspa-mainnet",
              virtualDaaScore: REFUND_LOCK_TIME,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              localTransactionId: TRANSACTION_ID,
              submittedTransactionId: TRANSACTION_ID,
            }),
            { status: 200 },
          ),
        ),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      broadcast: { submittedTransactionId: TRANSACTION_ID },
    });
  });

  it("returns JSON for unsupported methods", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
