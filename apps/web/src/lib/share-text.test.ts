import { describe, expect, it } from "vitest";

import {
  buildCreatorProfilePath,
  buildProfileXPostText,
  buildXBioText,
  buildXIntentUrl,
  buildXPostText,
} from "./share-text";

describe("share text helpers", () => {
  it("builds a creator profile path from the username", () => {
    expect(buildCreatorProfilePath("peter")).toBe("/u/peter");
  });

  it("builds X bio text around the public profile URL", () => {
    expect(buildXBioText("https://kaspalinks.com/u/peter")).toBe(
      "Support me with KAS: https://kaspalinks.com/u/peter | No extension. Wallet-to-wallet.",
    );
  });

  it("builds an X post that explains the non-custodial flow", () => {
    const text = buildXPostText({
      shareUrl: "https://kaspalinks.com/u/peter",
      title: "Support my work",
    });

    expect(text).toContain('for "Support my work"');
    expect(text).toContain("No extension. No custody. Wallet-to-wallet.");
    expect(text).toContain("https://kaspalinks.com/u/peter");
  });

  it("encodes the X intent URL without losing the text", () => {
    const text = "Support me with Kaspa";
    const url = new URL(
      buildXIntentUrl({
        hashtags: ["Kaspa", "#WalletToWallet"],
        text,
        url: "https://kaspalinks.com/u/peter",
      }),
    );

    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/intent/tweet");
    expect(url.searchParams.get("text")).toBe(text);
    expect(url.searchParams.get("url")).toBe("https://kaspalinks.com/u/peter");
    expect(url.searchParams.get("hashtags")).toBe("Kaspa,WalletToWallet");
  });

  it("can build X intent text without duplicating the URL", () => {
    const text = buildXPostText({
      includeUrl: false,
      shareUrl: "https://kaspalinks.com/u/peter",
      title: "Support my work",
    });

    expect(text).toContain("No extension. No custody. Wallet-to-wallet.");
    expect(text).not.toContain("https://kaspalinks.com/u/peter");
  });

  it("builds a profile-specific X post", () => {
    const text = buildProfileXPostText({
      profileUrl: "https://kaspalinks.com/u/peter",
    });

    expect(text).toContain("My Kaspa Links profile is live.");
    expect(text).toContain("Support me directly with KAS.");
    expect(text).toContain("No extension. No custody. Wallet-to-wallet.");
    expect(text).toContain("https://kaspalinks.com/u/peter");
  });
});
