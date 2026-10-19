import { describe, expect, it } from "vitest";

import {
  isClaimableAnonymousEnabled,
  isClaimableAutoReturnEnabled,
  isClaimDropAutoReturnEnabled,
} from "./claimable-flags";

describe("claimable flags", () => {
  it("are on in development and off in production unless set explicitly", () => {
    expect(isClaimableAutoReturnEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isClaimableAutoReturnEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isClaimableAutoReturnEnabled({
        CLAIMABLE_AUTO_RETURN_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isClaimableAutoReturnEnabled({
        CLAIMABLE_AUTO_RETURN_ENABLED: "false",
        NODE_ENV: "development",
      }),
    ).toBe(false);
  });

  it("only allows account-free links together with auto-return", () => {
    expect(
      isClaimableAnonymousEnabled({
        CLAIMABLE_ANONYMOUS_ENABLED: "true",
        CLAIMABLE_AUTO_RETURN_ENABLED: "false",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isClaimableAnonymousEnabled({
        CLAIMABLE_ANONYMOUS_ENABLED: "true",
        CLAIMABLE_AUTO_RETURN_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isClaimableAnonymousEnabled({
        CLAIMABLE_AUTO_RETURN_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("only creates auto-return Claim Drops when v2 links are on too", () => {
    expect(isClaimDropAutoReturnEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isClaimDropAutoReturnEnabled({
        CLAIM_DROP_AUTO_RETURN_ENABLED: "true",
        CLAIMABLE_AUTO_RETURN_ENABLED: "false",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isClaimDropAutoReturnEnabled({
        CLAIM_DROP_AUTO_RETURN_ENABLED: "true",
        CLAIMABLE_AUTO_RETURN_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toBe(true);
  });
});
