import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KasAmountInput } from "./KasAmountInput";

describe("KasAmountInput", () => {
  it("starts in KAS with $ and € waiting for a price", () => {
    const html = renderToStaticMarkup(
      <KasAmountInput id="amount" onChange={vi.fn()} placeholder="10" value="25" />,
    );

    expect(html).toContain('id="amount"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="25"');
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('title="Price not available"');
    // No estimate without a price.
    expect(html).not.toContain("kas-amount-estimate");
  });
});
