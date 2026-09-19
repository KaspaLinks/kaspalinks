import { describe, expect, it } from "vitest";

import { validateEscrowDraft, type EscrowDraftInput } from "./escrow-draft";

const VALID_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

const VALID_DRAFT: EscrowDraftInput = {
  condition: "used",
  description: "Latest model, 256 GB, very good condition.",
  payoutAddress: VALID_ADDRESS,
  priceKas: "4500",
  releaseWindowDays: 14,
  shippingKas: "50",
  title: "Smartphone Pro 256 GB",
};

describe("escrow draft validation", () => {
  it("accepts a complete draft and computes what each side locks", () => {
    const result = validateEscrowDraft(VALID_DRAFT);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.amounts?.buyerLockSompi).toBe(455_000_000_000n);
    expect(result.amounts?.totalLockedSompi).toBe(455_000_000_000n);
  });

  it("treats empty shipping as free shipping", () => {
    const result = validateEscrowDraft({ ...VALID_DRAFT, shippingKas: " " });
    expect(result.ok).toBe(true);
    expect(result.amounts?.shippingSompi).toBe(0n);
  });

  it("reports every missing or invalid field", () => {
    const result = validateEscrowDraft({
      ...VALID_DRAFT,
      condition: "",
      description: "   ",
      payoutAddress: "kaspatest:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
      priceKas: "0.1",
      shippingKas: "abc",
      title: "x".repeat(81),
    });

    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual([
      "condition",
      "description",
      "payoutAddress",
      "priceKas",
      "shippingKas",
      "title",
    ]);
    expect(result.errors.priceKas).toContain("0.2 KAS");
    expect(result.amounts).toBeNull();
  });

  it("keeps the preview amounts while other fields are still incomplete", () => {
    const result = validateEscrowDraft({ ...VALID_DRAFT, payoutAddress: "", title: "" });
    expect(result.ok).toBe(false);
    expect(result.amounts?.itemTotalSompi).toBe(455_000_000_000n);
  });
});
