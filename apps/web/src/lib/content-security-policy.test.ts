import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./content-security-policy";

function scriptSrc(csp: string): string {
  return csp.split("; ").find((part) => part.startsWith("script-src")) ?? "";
}

describe("buildContentSecurityPolicy", () => {
  it("allows inline scripts only with the request nonce", () => {
    const csp = buildContentSecurityPolicy({ development: false, nonce: "abc123", pathname: "/" });

    expect(scriptSrc(csp)).toContain("'nonce-abc123'");
    expect(csp).not.toContain("'unsafe-inline' https");
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-eval'");
    expect(scriptSrc(csp)).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("keeps 'unsafe-eval' only where the browser runs the Kaspa WASM signer", () => {
    for (const pathname of ["/claim/create/single", "/toccata-lab", "/escrows/abc"]) {
      const csp = buildContentSecurityPolicy({ development: false, nonce: "n", pathname });
      expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    }
    const elsewhere = buildContentSecurityPolicy({
      development: false,
      nonce: "n",
      pathname: "/claimable-anything-else",
    });
    expect(scriptSrc(elsewhere)).not.toContain("'unsafe-eval'");
  });

  it("lets Telegram Web embed only the Mini App pages", () => {
    const miniApp = buildContentSecurityPolicy({
      development: false,
      nonce: "n",
      pathname: "/telegram",
    });
    const signIn = buildContentSecurityPolicy({
      development: false,
      nonce: "n",
      pathname: "/sign-in",
    });
    const home = buildContentSecurityPolicy({
      development: false,
      nonce: "n",
      pathname: "/new-link",
    });

    expect(miniApp).toContain("frame-ancestors https://web.telegram.org");
    expect(signIn).toContain("frame-ancestors https://web.telegram.org");
    expect(home).toContain("frame-ancestors 'none'");
  });
});
