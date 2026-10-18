import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashManageToken, isAccountFreePaymentLinksEnabled } from "./account-free-links";

const TOKEN = "A".repeat(43);

describe("isAccountFreePaymentLinksEnabled", () => {
  it("is on in development and off in production unless set", () => {
    expect(isAccountFreePaymentLinksEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isAccountFreePaymentLinksEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      isAccountFreePaymentLinksEnabled({
        NODE_ENV: "production",
        PAYMENT_LINKS_ANONYMOUS_ENABLED: "true",
      }),
    ).toBe(true);
    expect(
      isAccountFreePaymentLinksEnabled({
        NODE_ENV: "development",
        PAYMENT_LINKS_ANONYMOUS_ENABLED: "false",
      }),
    ).toBe(false);
  });
});

describe("hashManageToken", () => {
  it("hashes a 43-character base64url token the same way the browser does", () => {
    expect(hashManageToken(TOKEN)).toBe(createHash("sha256").update(TOKEN).digest("hex"));
    expect(hashManageToken(` ${TOKEN} `)).toBe(hashManageToken(TOKEN));
  });

  it("refuses anything that is not a manage token", () => {
    expect(hashManageToken(null)).toBeNull();
    expect(hashManageToken("")).toBeNull();
    expect(hashManageToken("A".repeat(42))).toBeNull();
    expect(hashManageToken(`${"A".repeat(42)}+`)).toBeNull();
  });
});
