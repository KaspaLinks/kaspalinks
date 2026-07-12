import { describe, expect, it } from "vitest";

import {
  actionTypeLabel,
  buildActionSocialPreview,
  buildProfileSocialPreview,
  collapseWhitespace,
  truncatePreviewText,
} from "./social-preview";

describe("social preview helpers", () => {
  it("collapses whitespace for meta descriptions", () => {
    expect(collapseWhitespace("  hello\n\nKaspa\tLinks  ")).toBe("hello Kaspa Links");
  });

  it("truncates long preview text with an ellipsis", () => {
    expect(truncatePreviewText("a ".repeat(120), 20)).toBe("a a a a a a a a a a…");
  });

  it("builds a creator profile preview", () => {
    expect(
      buildProfileSocialPreview({
        bio: "Building tools for the Kaspa community.",
        displayName: "Ada",
        username: "ada",
      }),
    ).toEqual({
      description:
        "Building tools for the Kaspa community. Support Ada with direct Kaspa payments. Non-custodial, wallet-to-wallet.",
      title: "Ada on Kaspa Links",
    });
  });

  it("builds an action preview without exposing wallet addresses", () => {
    const preview = buildActionSocialPreview({
      amountKas: "10",
      creatorDisplayName: "Ada",
      description: null,
      title: "Buy me some KAS",
      type: "kaspa.tip",
    });

    expect(preview.title).toBe("Buy me some KAS · Ada");
    expect(preview.description).toBe(
      "Tip · 10 KAS. Pay Ada directly with Kaspa. Non-custodial, wallet-to-wallet.",
    );
    expect(preview.description).not.toContain("kaspa:");
  });

  it("formats known action type labels", () => {
    expect(actionTypeLabel("KASPA_GOAL")).toBe("Goal");
    expect(actionTypeLabel("kaspa.invoice")).toBe("Invoice");
  });
});
