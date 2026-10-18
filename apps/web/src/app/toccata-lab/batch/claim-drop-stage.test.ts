import { describe, expect, it } from "vitest";

import { claimDropProgress, claimDropStage, claimLinkLabel } from "./claim-drop-stage";

type LinkStatus =
  | "awaiting_activation"
  | "funded"
  | "refundable"
  | "claimed"
  | "refunded"
  | "spent_unknown"
  | "spent";

function batch(
  status: "awaiting_funding" | "funded" | "activated" | "refunded",
  links: LinkStatus[],
  recoveryExportedAt: string | null = "2026-10-18T10:00:00.000Z",
) {
  return {
    activation: { status } as never,
    links: links.map((linkStatus) => ({ status: linkStatus })) as never,
    recoveryExportedAt: recoveryExportedAt ?? undefined,
  };
}

describe("claimDropStage", () => {
  it("asks for the recovery file before anything else", () => {
    expect(
      claimDropStage({
        batch: batch("awaiting_funding", ["awaiting_activation", "awaiting_activation"], null),
        expired: false,
      }),
    ).toBe("save");
  });

  it("moves from payment to activation to sharing", () => {
    const pending: LinkStatus[] = ["awaiting_activation", "awaiting_activation"];
    expect(claimDropStage({ batch: batch("awaiting_funding", pending), expired: false })).toBe(
      "fund",
    );
    expect(claimDropStage({ batch: batch("funded", pending), expired: false })).toBe("activate");
    expect(
      claimDropStage({ batch: batch("activated", ["funded", "funded"]), expired: false }),
    ).toBe("share");
  });

  it("offers only the whole-drop refund when the window closed before activation", () => {
    expect(
      claimDropStage({
        batch: batch("funded", ["awaiting_activation", "awaiting_activation"]),
        expired: true,
      }),
    ).toBe("refund_unactivated");
  });

  it("offers link refunds only while a link is still unclaimed", () => {
    expect(
      claimDropStage({ batch: batch("activated", ["claimed", "funded"]), expired: true }),
    ).toBe("refund_links");
    expect(
      claimDropStage({ batch: batch("activated", ["claimed", "refundable"]), expired: true }),
    ).toBe("refund_links");
  });

  it("is done once every link is claimed or refunded, whatever the clock says", () => {
    // The drop from the reported screenshot: expired, every link already spent.
    expect(
      claimDropStage({ batch: batch("activated", ["spent", "spent", "spent"]), expired: true }),
    ).toBe("done");
    expect(
      claimDropStage({ batch: batch("activated", ["claimed", "refunded"]), expired: false }),
    ).toBe("done");
    expect(
      claimDropStage({
        batch: batch("refunded", ["awaiting_activation", "awaiting_activation"]),
        expired: true,
      }),
    ).toBe("done");
  });
});

describe("claimDropProgress", () => {
  it("counts claimed, refunded and still open links", () => {
    expect(
      claimDropProgress(batch("activated", ["claimed", "refunded", "funded", "spent_unknown"])),
    ).toEqual({ claimed: 1, open: 1, refunded: 1, total: 4 });
  });
});

describe("claimLinkLabel", () => {
  it("calls an unclaimed link refundable only after the window", () => {
    expect(claimLinkLabel("funded", false)).toBe("Ready");
    expect(claimLinkLabel("funded", true)).toBe("Refundable");
    expect(claimLinkLabel("claimed", true)).toBe("Claimed");
    expect(claimLinkLabel("spent_unknown", false)).toBe("Spent");
  });
});
