import { describe, expect, it } from "vitest";

import { buildFundingQrPath, pngBytesToDataUrl } from "./funding-qr-image";

describe("funding QR image helpers", () => {
  it("builds a validated PNG request without exposing unrelated fields", () => {
    const path = buildFundingQrPath({
      amountKas: "1.002",
      label: "Kaspa Links claimable link",
      recipientAddress: "kaspa:ppxs4re563xwzukl45zty86hrppgqnyvqw85lsgxjh0fplwcjge3yujst6uke",
    });
    const url = new URL(path, "https://kaspalinks.com");

    expect(url.pathname).toBe("/api/toccata-lab/qr");
    expect(url.searchParams.get("amountKas")).toBe("1.002");
    expect(url.searchParams.get("format")).toBe("png");
    expect(url.searchParams.get("size")).toBe("512");
    expect(url.searchParams.get("recipientAddress")).toBe(
      "kaspa:ppxs4re563xwzukl45zty86hrppgqnyvqw85lsgxjh0fplwcjge3yujst6uke",
    );
  });

  it("creates an inline PNG URL from a validated response", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

    expect(pngBytesToDataUrl(bytes)).toBe("data:image/png;base64,iVBORw0KGgoBAgM=");
  });

  it("rejects non-PNG response bytes", () => {
    expect(() => pngBytesToDataUrl(new TextEncoder().encode("not an image"))).toThrow(
      "QR endpoint did not return a PNG image.",
    );
  });
});
