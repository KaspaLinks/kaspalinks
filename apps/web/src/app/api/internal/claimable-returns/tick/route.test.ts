import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessClaimBatchReturns, mockProcessClaimableReturns } = vi.hoisted(() => ({
  mockProcessClaimBatchReturns: vi.fn(),
  mockProcessClaimableReturns: vi.fn(),
}));

vi.mock("@/lib/claimable-return", () => ({
  defaultClaimableReturnDeps: { readDaaScore: async () => 500_000_000n },
  processClaimableReturns: mockProcessClaimableReturns,
}));
vi.mock("@/lib/claimable-batch-return", () => ({
  processClaimBatchReturns: mockProcessClaimBatchReturns,
}));

import { POST } from "./route";

function call(secret?: string) {
  return POST(
    new Request("https://example.com/api/internal/claimable-returns/tick", {
      headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      method: "POST",
    }),
  );
}

describe("POST /api/internal/claimable-returns/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "s".repeat(40));
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    mockProcessClaimableReturns.mockResolvedValue({
      checked: 1,
      deletedUnfunded: 0,
      failed: 0,
      returned: 1,
    });
    mockProcessClaimBatchReturns.mockResolvedValue({ checked: 1, failed: 0, returned: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is invisible without the internal secret", async () => {
    expect((await call()).status).toBe(404);
    expect((await call("wrong")).status).toBe(404);
    expect(mockProcessClaimableReturns).not.toHaveBeenCalled();
  });

  it("runs one return pass over links and unactivated Claim Drops", async () => {
    const response = await call("s".repeat(40));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batches: { checked: 1, returned: 0 },
      returned: 1,
    });
    expect(mockProcessClaimableReturns).toHaveBeenCalledTimes(1);
    expect(mockProcessClaimBatchReturns).toHaveBeenCalledWith(expect.any(Date), 500_000_000n);
  });
});
