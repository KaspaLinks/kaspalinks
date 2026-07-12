import { describe, expect, it } from "vitest";

import { createKaspaActionButtonHtml, createKaspaActionUrl } from "./index";

describe("createKaspaActionUrl", () => {
  it("creates a public Action URL from an app URL and public id", () => {
    expect(createKaspaActionUrl({ appUrl: "https://kaspa.example", publicId: "demo-action" })).toBe(
      "https://kaspa.example/a/demo-action",
    );
  });

  it("preserves a deployment base path and removes query or hash input", () => {
    expect(
      createKaspaActionUrl({
        appUrl: "https://kaspa.example/actions/?utm=ignored#top",
        publicId: "abc_123",
      }),
    ).toBe("https://kaspa.example/actions/a/abc_123");
  });

  it("rejects unsafe inputs", () => {
    expect(() => createKaspaActionUrl({ appUrl: "javascript:alert(1)", publicId: "demo" })).toThrow(
      "appUrl must use http or https.",
    );
    expect(() =>
      createKaspaActionUrl({ appUrl: "https://kaspa.example", publicId: "../x" }),
    ).toThrow("publicId must be 3-128 URL-safe characters.");
  });
});

describe("createKaspaActionButtonHtml", () => {
  it("renders safe default button markup", () => {
    expect(
      createKaspaActionButtonHtml({
        appUrl: "https://kaspa.example",
        publicId: "demo-action",
      }),
    ).toContain('href="https://kaspa.example/a/demo-action"');
    expect(
      createKaspaActionButtonHtml({
        appUrl: "https://kaspa.example",
        publicId: "demo-action",
      }),
    ).toContain('rel="noopener noreferrer"');
  });

  it("escapes text and attributes", () => {
    const html = createKaspaActionButtonHtml({
      appUrl: "https://kaspa.example",
      className: 'kaspa" onclick="bad',
      label: 'Tip <Ada> & "friends"',
      publicId: "demo-action",
      theme: "unstyled",
    });

    expect(html).toContain('class="kaspa&quot; onclick=&quot;bad"');
    expect(html).toContain("Tip &lt;Ada&gt; &amp; &quot;friends&quot;");
    expect(html).not.toContain("style=");
  });

  it("omits blank rel when opening in the same tab", () => {
    const html = createKaspaActionButtonHtml({
      appUrl: "https://kaspa.example",
      publicId: "demo-action",
      target: "_self",
      theme: "unstyled",
    });

    expect(html).toContain('target="_self"');
    expect(html).not.toContain("rel=");
  });
});
