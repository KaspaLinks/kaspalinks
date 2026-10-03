import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProcessClaimableReturns } = vi.hoisted(() => ({
  mockProcessClaimableReturns: vi.fn(),
}));

vi.mock("@/lib/claimable-return", () => ({
  processClaimableReturns: mockProcessClaimableReturns,
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is invisible without the internal secret", async () => {
    expect((await call()).status).toBe(404);
    expect((await call("wrong")).status).toBe(404);
    expect(mockProcessClaimableReturns).not.toHaveBeenCalled();
  });

  it("runs one return pass for the worker", async () => {
    const response = await call("s".repeat(40));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ returned: 1 });
    expect(mockProcessClaimableReturns).toHaveBeenCalledTimes(1);
  });
});
