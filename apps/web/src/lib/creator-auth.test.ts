import { describe, expect, it } from "vitest";

import {
  generateCreatorToken,
  hashCreatorToken,
  isCreatorSignupEnabled,
  readBearerToken,
  readCreatorToken,
  readCreatorActionDailyLimit,
  rollingDailyWindowStart,
  verifyCreatorToken,
} from "./creator-auth";

describe("creator token helpers", () => {
  it("generates one-time tokens and verifies only their hashes", () => {
    const token = generateCreatorToken();
    const hash = hashCreatorToken(token);

    expect(token).toMatch(/^ka_creator_/);
    expect(hash).toHaveLength(64);
    expect(verifyCreatorToken(token, hash)).toBe(true);
    expect(verifyCreatorToken(`${token}x`, hash)).toBe(false);
    expect(verifyCreatorToken(token, "not-hex")).toBe(false);
  });

  it("parses bearer tokens without accepting other schemes", () => {
    expect(readBearerToken("Bearer secret")).toBe("secret");
    expect(readBearerToken("Bearer   ")).toBeNull();
    expect(readBearerToken("Basic secret")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });

  it("prefers the explicit creator-token header and falls back to bearer auth", () => {
    expect(
      readCreatorToken(
        new Headers({
          authorization: "Basic site-lock",
          "x-creator-token": "explicit",
        }),
      ),
    ).toBe("explicit");
    expect(readCreatorToken(new Headers({ authorization: "Bearer fallback" }))).toBe("fallback");
    expect(readCreatorToken(new Headers({ authorization: "Basic site-lock" }))).toBeNull();
  });

  it("defaults signup to disabled in production unless explicitly enabled", () => {
    expect(isCreatorSignupEnabled(undefined, "production")).toBe(false);
    expect(isCreatorSignupEnabled("true", "production")).toBe(true);
    expect(isCreatorSignupEnabled("false", "development")).toBe(false);
    expect(isCreatorSignupEnabled(undefined, "development")).toBe(true);
  });

  it("bounds the daily creator Action limit", () => {
    expect(readCreatorActionDailyLimit(undefined)).toBe(50);
    expect(readCreatorActionDailyLimit("10")).toBe(10);
    expect(readCreatorActionDailyLimit("9999")).toBe(500);
    expect(readCreatorActionDailyLimit("nope")).toBe(50);
  });

  it("uses a rolling 24 hour window", () => {
    expect(rollingDailyWindowStart(new Date("2026-01-02T12:00:00.000Z")).toISOString()).toBe(
      "2026-01-01T12:00:00.000Z",
    );
  });
});
