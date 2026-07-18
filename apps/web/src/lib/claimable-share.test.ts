import { describe, expect, it } from "vitest";

import {
  buildCompactClaimUrl,
  buildClaimableXPostText,
  decodeClaimableFragmentPayload,
  decodeSharedClaimCode,
  encodeClaimableFragmentPayload,
  encodeClaimCodeForSharing,
  extractClaimCodeFromClaimUrl,
  extractClaimableFundingProofFromManageUrl,
  withClaimablePreviewVersion,
} from "./claimable-share";
import { buildXIntentUrl } from "./share-text";

const PRIVATE_KEY = "01".repeat(32);

describe("claimable social sharing", () => {
  it("round-trips Unicode titles and descriptions in browser-only fragments", () => {
    const payload = {
      description: "Grüße für die Community 🎁",
      title: "Let’s try a claimable link on X!",
    };

    expect(decodeClaimableFragmentPayload(encodeClaimableFragmentPayload(payload))).toEqual(
      payload,
    );
  });

  it("round-trips a compact claim code without sending it to the server", () => {
    const compact = encodeClaimCodeForSharing(PRIVATE_KEY);

    expect(compact).toHaveLength(43);
    expect(decodeSharedClaimCode(compact)).toBe(PRIVATE_KEY);
    expect(decodeSharedClaimCode(PRIVATE_KEY.toUpperCase())).toBe(PRIVATE_KEY);
  });

  it("rejects malformed claim codes", () => {
    expect(() => decodeSharedClaimCode("not-a-claim-code")).toThrow("43-character claim code");
  });

  it("builds X copy without exposing or asking for a claim code", () => {
    const text = buildClaimableXPostText({
      netClaimKas: "9.998",
      title: "Happy weekend",
    });

    expect(text).toContain("9.998 KAS");
    expect(text).not.toContain("Claim code");
    expect(text).not.toContain(encodeClaimCodeForSharing(PRIVATE_KEY));
    expect(text).not.toContain("kaspalinks.com");
  });

  it("moves a legacy claim secret into a compact browser-only fragment", () => {
    const payload = btoa(JSON.stringify({ claimCode: PRIVATE_KEY }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const compactUrl = buildCompactClaimUrl(
      `https://kaspalinks.com/claim?link=test#lab-claim=${payload}`,
    );
    const url = new URL(compactUrl);

    expect(url.searchParams.get("link")).toBe("test");
    expect(url.searchParams.get("preview")).toBe("5");
    expect(url.hash).toBe(`#c=${encodeClaimCodeForSharing(PRIVATE_KEY)}`);
    expect(extractClaimCodeFromClaimUrl(compactUrl)).toBe(PRIVATE_KEY);

    const intent = new URL(buildXIntentUrl({ text: "Claim KAS", url: compactUrl }));
    expect(intent.searchParams.get("url")).toBe(compactUrl);
  });

  it("recovers the browser-only claim code from an existing private claim URL", () => {
    const payload = btoa(JSON.stringify({ claimCode: PRIVATE_KEY }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    expect(
      extractClaimCodeFromClaimUrl(`https://kaspalinks.com/claim?link=test#lab-claim=${payload}`),
    ).toBe(PRIVATE_KEY);
    expect(() => extractClaimCodeFromClaimUrl("https://kaspalinks.com/claim?link=test")).toThrow(
      "not available",
    );
  });

  it("adds a cache-busting preview version without moving the claim code out of the fragment", () => {
    const versioned = withClaimablePreviewVersion(
      "https://kaspalinks.com/claim?link=test#lab-claim=browser-only",
    );
    const url = new URL(versioned);

    expect(url.searchParams.get("preview")).toBe("5");
    expect(url.hash).toBe("#lab-claim=browser-only");
  });

  it("extracts only public funding proof from a private refund URL", () => {
    const fundingTransactionId = "ab".repeat(32);
    const encoded = encodeClaimableFragmentPayload({
      amountSompi: "1200000000",
      createdAtMs: 1_700_000_000_000,
      fundingAddress: "kaspa:funding",
      fundingMatch: {
        amountSompi: "1200000000",
        outputIndex: 2,
        transactionId: fundingTransactionId,
      },
      id: "batch-safe-01",
      refundCode: PRIVATE_KEY,
    });

    const proof = extractClaimableFundingProofFromManageUrl(
      `https://kaspalinks.com/claim/refund#lab-manage=${encoded}`,
      "batch-safe-01",
    );

    expect(proof).toEqual({
      amountSompi: "1200000000",
      fundingAddress: "kaspa:funding",
      fundingOutputIndex: 2,
      fundingTransactionId,
      notBefore: 1_700_000_000_000,
    });
    expect(proof).not.toHaveProperty("refundCode");
  });

  it("rejects funding proof for a different local link", () => {
    const encoded = encodeClaimableFragmentPayload({
      amountSompi: "1200000000",
      createdAtMs: 1_700_000_000_000,
      fundingAddress: "kaspa:funding",
      fundingMatch: {
        amountSompi: "1200000000",
        outputIndex: 0,
        transactionId: "ab".repeat(32),
      },
      id: "batch-other-01",
    });

    expect(() =>
      extractClaimableFundingProofFromManageUrl(
        `https://kaspalinks.com/claim/refund#lab-manage=${encoded}`,
        "batch-safe-01",
      ),
    ).toThrow("cannot verify");
  });
});
