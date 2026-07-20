import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFundingQrMatrix, FundingQrCode } from "./funding-qr";

const FUNDING_URI =
  "kaspa:ppxs4re563xwzukl45zty86hrppgqnyvqw85lsgxjh0fplwcjge3yujst6uke?amount=1.002";

describe("funding QR helpers", () => {
  it("creates a directly renderable SVG matrix from a payment URI", () => {
    const matrix = createFundingQrMatrix(FUNDING_URI);

    expect(matrix.viewBoxSize).toBeGreaterThan(20);
    expect(matrix.path).toMatch(/^M\d+ \d+h\d+v1H\d+z/);
    expect(matrix.path.length).toBeGreaterThan(1_000);
  });

  it("rejects an empty payment URI", () => {
    expect(() => createFundingQrMatrix(" ")).toThrow("Funding payment URI is missing.");
  });

  it("renders the QR directly as SVG without an image source", () => {
    const markup = renderToStaticMarkup(
      createElement(FundingQrCode, {
        ariaLabel: "Funding QR code for 1.002 KAS",
        paymentUri: FUNDING_URI,
      }),
    );

    expect(markup).toContain('<svg aria-label="Funding QR code for 1.002 KAS"');
    expect(markup).toContain("<path");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("data:image");
  });
});
