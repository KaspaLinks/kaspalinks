import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy } from "./content-security-policy";

const caddy = readFileSync("deploy/Caddyfile", "utf8");

describe("Caddy authentication boundaries", () => {
  it("keeps operator pages gated and public creator flows outside the shared password", () => {
    const operator = caddy.match(/@operator path ([^\n]+)/)?.[1]?.split(" ") ?? [];
    for (const path of ["/admin", "/api/admin/*", "/operator-stats", "/operator-stats/*"]) {
      expect(operator).toContain(path);
    }
    // Claim Drops are public: these APIs need a signed-in creator or only see public keys.
    for (const path of [
      "/claim/batch",
      "/api/toccata-lab/batch-scripts",
      "/api/toccata-lab/batch-allocator-script",
      "/api/toccata-lab/batch-activate",
      "/api/toccata-lab/batch-refund",
      "/api/actions",
      "/manage/*",
    ]) {
      expect(operator).not.toContain(path);
    }
  });

  it("removes every application credential header before access-log storage", () => {
    for (const header of [
      "Authorization",
      "X-Creator-Token",
      "X-Manage-Token",
      "X-Admin-Token",
      "X-Telegram-Mini-App-Init-Data",
      "X-Telegram-Bot-Api-Secret-Token",
    ]) {
      expect(caddy).toContain(`request>headers>${header} delete`);
    }
  });
  it("preserves upstream no-store policies for private responses and errors", () => {
    expect(caddy).not.toMatch(/header_down\s+Cache-Control/);
    expect(caddy).toContain("reverse_proxy app:3000");
  });
  it("limits Telegram Web framing to the Mini App and its account continuation", () => {
    expect(caddy).toContain(
      "@telegramMini path /telegram /telegram/* /toccata-lab/giveaway /toccata-lab/giveaway/* /sign-in /create-profile",
    );
    expect(caddy).toMatch(/header @telegramMini \{\s*defer\s*-X-Frame-Options\s*\}/);
    expect(caddy).toContain('X-Frame-Options "DENY"');
    // The pages' CSP, frame-ancestors included, comes from the app: Caddy only
    // sets its policy where a response has none.
    expect(caddy).toContain("?Content-Security-Policy");
    expect(caddy).not.toMatch(/^\s*Content-Security-Policy /m);
    for (const pathname of [
      "/telegram",
      "/toccata-lab/giveaway/x",
      "/sign-in",
      "/create-profile",
    ]) {
      expect(buildContentSecurityPolicy({ development: false, nonce: "n", pathname })).toContain(
        "frame-ancestors https://web.telegram.org",
      );
    }
    expect(buildContentSecurityPolicy({ development: false, nonce: "n", pathname: "/" })).toContain(
      "frame-ancestors 'none'",
    );
  });
});
