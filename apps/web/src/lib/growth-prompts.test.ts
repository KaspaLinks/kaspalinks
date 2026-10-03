import { describe, expect, it } from "vitest";

import { buildPayShareUrl, GROWTH_PROMPTS } from "./growth-prompts";

describe("growth prompts", () => {
  it("links each prompt to signup with its next step and label", () => {
    expect(GROWTH_PROMPTS["pay-success"].href).toBe(
      "/create-profile?next=%2Fnew-link&utm_source=pay-success",
    );
    expect(GROWTH_PROMPTS["claim-success"].href).toBe(
      "/create-profile?next=%2Fclaim%2Fcreate&utm_source=claim-success",
    );
    expect(GROWTH_PROMPTS["claim-success"].cta).toBe("Send KAS to a friend the same way");
  });

  it("never puts a fragment into a prompt link", () => {
    for (const prompt of Object.values(GROWTH_PROMPTS)) {
      expect(prompt.href).not.toContain("#");
      expect(prompt.accountFreeHref ?? "").not.toContain("#");
    }
  });

  it("skips signup after a claim when links work without an account", () => {
    expect(GROWTH_PROMPTS["claim-success"].accountFreeHref).toBe(
      "/claim/create/single?utm_source=claim-success",
    );
    expect(GROWTH_PROMPTS["pay-success"].accountFreeHref).toBeUndefined();
  });
});

describe("buildPayShareUrl", () => {
  const origin = "https://kaspalinks.com";

  it("shares payment and profile pages with the pay-share label", () => {
    expect(buildPayShareUrl({ origin, pathname: "/a/abc123" })).toBe(
      "https://kaspalinks.com/a/abc123?utm_source=pay-share",
    );
    expect(buildPayShareUrl({ origin, pathname: "/u/ada/coffee" })).toBe(
      "https://kaspalinks.com/u/ada/coffee?utm_source=pay-share",
    );
  });

  it("drops any query string or fragment", () => {
    expect(buildPayShareUrl({ origin, pathname: "/a/abc123?pr=secret#c=key" })).toBe(
      "https://kaspalinks.com/a/abc123?utm_source=pay-share",
    );
    expect(buildPayShareUrl({ origin, pathname: "/u/ada#c=key" })).toBe(
      "https://kaspalinks.com/u/ada?utm_source=pay-share",
    );
  });

  it("refuses claim pages and anything that is not a public payment page", () => {
    expect(buildPayShareUrl({ origin, pathname: "/claim/xyz" })).toBeNull();
    expect(buildPayShareUrl({ origin, pathname: "/toccata-lab" })).toBeNull();
    expect(buildPayShareUrl({ origin, pathname: "//evil.example/a/x" })).toBeNull();
    expect(buildPayShareUrl({ origin, pathname: "" })).toBeNull();
  });
});
