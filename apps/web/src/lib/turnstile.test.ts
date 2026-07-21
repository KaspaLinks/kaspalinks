import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGiveawayTurnstileClientConfig, verifyGiveawayTurnstile } from "./turnstile";

describe("giveaway Turnstile verification", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kaspalinks.com");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not call Cloudflare while the protection is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(verifyGiveawayTurnstile({ token: undefined })).resolves.toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a single giveaway-entry token against the expected hostname", async () => {
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "true");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ action: "giveaway-entry", hostname: "kaspalinks.com", success: true }),
          { status: 200 },
        ),
      );

    await expect(
      verifyGiveawayTurnstile({ remoteIp: "203.0.113.42", token: "verified-token" }),
    ).resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = request?.[1]?.body as URLSearchParams;
    expect(body.get("response")).toBe("verified-token");
    expect(body.get("remoteip")).toBe("203.0.113.42");
  });

  it("rejects failed, wrong-action, and wrong-hostname responses", async () => {
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "true");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    );
    await expect(verifyGiveawayTurnstile({ token: "token-1" })).resolves.toEqual({
      kind: "invalid",
      ok: false,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ action: "other-action", hostname: "kaspalinks.com", success: true }),
        { status: 200 },
      ),
    );
    await expect(verifyGiveawayTurnstile({ token: "token-2" })).resolves.toEqual({
      kind: "invalid",
      ok: false,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ action: "giveaway-entry", hostname: "example.com", success: true }),
        { status: 200 },
      ),
    );
    await expect(verifyGiveawayTurnstile({ token: "token-3" })).resolves.toEqual({
      kind: "invalid",
      ok: false,
    });
  });

  it("fails closed when the secret or verification service is unavailable", async () => {
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyGiveawayTurnstile({ token: "token" })).resolves.toEqual({
      kind: "unavailable",
      ok: false,
    });

    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));
    await expect(verifyGiveawayTurnstile({ token: "token" })).resolves.toEqual({
      kind: "unavailable",
      ok: false,
    });
  });

  it("exposes only the non-secret browser configuration", () => {
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "true");
    expect(getGiveawayTurnstileClientConfig()).toEqual({ required: true, siteKey: "site-key" });
  });
});
