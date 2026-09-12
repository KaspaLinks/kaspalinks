import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ready: vi.fn(),
  register: vi.fn(),
  verify: vi.fn(),
  normalize: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/public-covenant", () => ({
  publicCovenantVerificationReady: m.ready,
  registerPublicCovenant: m.register,
}));
vi.mock("@/lib/turnstile", () => ({ verifyGiveawayTurnstile: m.verify }));
vi.mock("@/lib/giveaway-lab", () => ({ normalizeGiveawayAddress: m.normalize }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_ENTRY: "entry" },
  enforceRateLimit: m.limit,
}));
vi.mock("@/lib/client-ip", () => ({ extractClientIp: () => "ip", hashClientIp: () => "hash" }));
import { POST } from "./route";
const post = (body: unknown) =>
  POST(new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "cmf12345678901234567890123" }),
  });
const body = { address: "kaspa:" + "a".repeat(60), turnstileToken: "test-token" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "true");
  m.ready.mockReturnValue(true);
  m.limit.mockReturnValue({ allowed: true });
  m.normalize.mockReturnValue("kaspa:canonical");
  m.verify.mockResolvedValue({ ok: true });
  m.register.mockResolvedValue(1);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("public covenant entry endpoint", () => {
  it("requires configured successful verification before any database admission", async () => {
    m.ready.mockReturnValue(false);
    expect((await post(body)).status).toBe(503);
    expect(m.register).not.toHaveBeenCalled();
    m.ready.mockReturnValue(true);
    m.verify.mockResolvedValue({ ok: false, kind: "invalid" });
    expect((await post(body)).status).toBe(403);
    expect(m.register).not.toHaveBeenCalled();
  });
  it("rejects secret or extra fields and invalid addresses", async () => {
    expect((await post({ ...body, privateKey: "never" })).status).toBe(400);
    m.normalize.mockImplementation(() => {
      throw new Error();
    });
    expect((await post(body)).status).toBe(400);
    expect(m.register).not.toHaveBeenCalled();
  });
  it("uses canonical address and reports duplicate-address conflicts", async () => {
    expect((await post(body)).status).toBe(201);
    expect(m.register).toHaveBeenCalledWith("cmf12345678901234567890123", "kaspa:canonical");
    m.register.mockRejectedValue({ code: "P2002" });
    expect((await post(body)).status).toBe(409);
  });
  it("does not expose internal failures", async () => {
    m.register.mockRejectedValue(new Error("private db detail"));
    const r = await post(body);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("private db detail");
  });
});
