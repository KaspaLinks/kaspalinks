import type { GiveawayV6ReconstructionSnapshot } from "@kaspa-actions/kaspa-indexer";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import V6GiveawayView from "./V6GiveawayView";

function snapshot(
  phase: GiveawayV6ReconstructionSnapshot["phase"],
): GiveawayV6ReconstructionSnapshot {
  return {
    phase,
    activationTransactionId: "01".repeat(32),
    freezeTransactionId:
      phase === "awaiting_activation" || phase === "open" ? null : "02".repeat(32),
    terminalTransactionId: phase === "drawn" ? "03".repeat(32) : null,
    prizeOutpoint: { transactionId: "01".repeat(32), outputIndex: 0 },
    observedRegistrationCount: 12,
    frozenEntryCount: phase === "awaiting_activation" || phase === "open" ? null : 12,
    frozenRootHex: phase === "awaiting_activation" || phase === "open" ? null : "04".repeat(32),
    shards: [],
    winner:
      phase === "drawn"
        ? {
            globalIndex: 5,
            shardIndex: 1,
            localIndex: 2,
            payoutScriptPublicKeyHex: "000051",
            commitmentHex: "05".repeat(32),
            merkleSiblingsHex: [],
            candidateBlockHashHex: "06".repeat(32),
            candidateSequenceCommitmentHex: "07".repeat(32),
            drawTransactionId: "03".repeat(32),
          }
        : null,
  };
}

function render(phase: GiveawayV6ReconstructionSnapshot["phase"]) {
  return renderToStaticMarkup(
    <V6GiveawayView
      amountKas="1"
      closesAt={new Date("2026-10-11T12:00:00.000Z")}
      closesAtDaa="123456"
      lastSyncedAt={new Date("2026-10-10T12:00:00.000Z")}
      network="mainnet"
      publicId="cm12345678901234567890123"
      returnAtDaa="223456"
      snapshot={snapshot(phase)}
      title="Community giveaway"
      transitionCount={15}
      username="example"
      verificationPaused={false}
      winnerAddress={phase === "drawn" ? `kaspa:${"q".repeat(61)}` : null}
    />,
  );
}

describe("V6GiveawayView", () => {
  it("keeps the open mobile flow scannable and shows the on-chain count", () => {
    const html = render("open");

    expect(html).toContain("Entries are open");
    expect(html).toContain(">12</strong><span>confirmed participants");
    expect(html).toContain("Verified from Kaspa L1");
    expect(html).toContain("123456");
    expect(html).toContain("223456");
    expect(html).toContain("Open verification data");
    expect(html).not.toMatch(/privateKey|seedPhrase|witness/i);
  });

  it("shows the winner and payout transaction after the draw", () => {
    const html = render("drawn");

    expect(html).toContain("Prize paid automatically");
    expect(html).toContain(`kaspa:${"q".repeat(61)}`);
    expect(html).toContain(`/txs/${"03".repeat(32)}`);
  });
});
