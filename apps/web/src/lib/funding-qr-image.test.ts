import { describe, expect, it } from "vitest";

import { createFundingQrDataUrl } from "./funding-qr-image";

describe("funding QR image helpers", () => {
  it("creates an inline PNG QR from a payment URI", async () => {
    const dataUrl = await createFundingQrDataUrl(
      "kaspa:ppxs4re563xwzukl45zty86hrppgqnyvqw85lsgxjh0fplwcjge3yujst6uke?amount=1.002",
    );

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dataUrl.length).toBeGreaterThan(1_000);
  });

  it("rejects an empty payment URI", async () => {
    await expect(createFundingQrDataUrl(" ")).rejects.toThrow("Funding payment URI is missing.");
  });
});
