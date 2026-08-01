import { describe, expect, it } from "vitest";

import {
  actionTypeLabel,
  buildActionSocialPreview,
  buildGiveawaySocialPreview,
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

  it("builds an unmistakable open-giveaway preview", () => {
    expect(
      buildGiveawaySocialPreview({
        amountKas: "25",
        closesAt: "2099-08-01T20:00:00.000Z",
        description: "Weekend reward for the Kaspa community.",
        prizeFunded: true,
        status: "OPEN",
        title: "Weekend giveaway",
      }),
    ).toEqual({
      amountLabel: "25 KAS prize",
      description:
        "Weekend reward for the Kaspa community. The 25 KAS prize is verified on-chain. The winner is selected with a verifiable Kaspa draw. Non-custodial and wallet-to-wallet.",
      title: "Weekend giveaway · Win 25 KAS",
      typeLabel: "Enter giveaway",
    });
  });

  it("does not repeat the entry invitation from the giveaway description", () => {
    const preview = buildGiveawaySocialPreview({
      amountKas: "2",
      closesAt: "2099-08-01T20:00:00.000Z",
      description: "Enter your Kaspa address for a chance to win.",
      prizeFunded: true,
      status: "OPEN",
      title: "Weekend giveaway",
    });

    expect(preview.description).toBe(
      "Enter your Kaspa address for a chance to win. The 2 KAS prize is verified on-chain. The winner is selected with a verifiable Kaspa draw. Non-custodial and wallet-to-wallet.",
    );
    expect(preview.description.match(/chance to win/gi)).toHaveLength(1);
  });

  it("shows a closed state when the entry deadline has passed", () => {
    const preview = buildGiveawaySocialPreview({
      amountKas: "5",
      closesAt: "2020-01-01T00:00:00.000Z",
      prizeFunded: true,
      status: "OPEN",
      title: "Community draw",
    });

    expect(preview.title).toBe("Community draw · Entries closed");
    expect(preview.typeLabel).toBe("Draw pending");
  });
});
