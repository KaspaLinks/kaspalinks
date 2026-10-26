import type { GiveawayV6ReconstructionSnapshot } from "@kaspa-actions/kaspa-indexer";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/toccata-lab/giveaway/[publicId]/TurnstileWidget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

import V6GiveawayView from "./V6GiveawayView";

function snapshot(
  phase: GiveawayV6ReconstructionSnapshot["phase"],
  frozenEntryCount = 12,
): GiveawayV6ReconstructionSnapshot {
  return {
    phase,
    activationTransactionId: "01".repeat(32),
    freezeTransactionId:
      phase === "awaiting_activation" || phase === "open" ? null : "02".repeat(32),
    terminalTransactionId: phase === "drawn" ? "03".repeat(32) : null,
    prizeOutpoint: { transactionId: "01".repeat(32), outputIndex: 0 },
    observedRegistrationCount: 12,
    frozenEntryCount: phase === "awaiting_activation" || phase === "open" ? null : frozenEntryCount,
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

function render(
  phase: GiveawayV6ReconstructionSnapshot["phase"],
  frozenEntryCount?: number,
  participantCap?: number,
) {
  return renderToStaticMarkup(
    <V6GiveawayView
      participantCap={participantCap}
      amountKas="1"
      entryAvailable={true}
      closesAt={new Date("2026-10-11T12:00:00.000Z")}
      closesAtDaa="123456"
      lastSyncedAt={new Date("2026-10-10T12:00:00.000Z")}
      network="mainnet"
      publicId="cm12345678901234567890123"
      returnAtDaa="223456"
      snapshot={snapshot(phase, frozenEntryCount)}
      title="Community giveaway"
      turnstileSiteKey="site-key"
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

  it("names the close in UTC on the server and promises an automatic payout", () => {
    const html = render("open");

    expect(html).toContain(
      'Entries close <time dateTime="2026-10-11T12:00:00.000Z">Oct 11, 12:00 UTC</time>',
    );
    expect(html).toContain("the winner is paid automatically, usually within about 30 minutes");
    expect(html).toContain("Paid automatically, usually about 30 minutes after close");
  });

  it("tells participants when the winner is expected while the proof runs", () => {
    const html = render("frozen");

    expect(html).toContain("Entries locked · drawing winner");
    expect(html).toContain("Kaspa Links is proving the random block now");
    expect(html).toContain('<time dateTime="2026-10-11T12:30:00.000Z">Oct 11, 12:30 UTC</time>');
  });

  it("does not promise a draw when nobody entered", () => {
    const html = render("frozen", 0);

    expect(html).toContain("Entries closed · nobody entered");
    expect(html).not.toContain("proving the random block");
  });

  it("shows the winner and payout transaction after the draw", () => {
    const html = render("drawn");

    expect(html).toContain("Prize paid automatically");
    expect(html).toContain(`kaspa:${"q".repeat(61)}`);
    expect(html).toContain(`https://kaspa.stream/transactions/${"03".repeat(32)}`);
  });

  it("counts spots against the committed cap and keeps entering open below it", () => {
    const html = render("open", undefined, 32);

    expect(html).toContain(">12</strong><span>of 32 spots taken");
    expect(html).toContain("Join giveaway");
    expect(html).not.toContain("This giveaway is full");
  });

  it("puts the entry form right after the prize while entries are open", () => {
    const open = render("open", undefined, 32);
    expect(open.indexOf("Paste your Kaspa address")).toBeGreaterThan(-1);
    expect(open.indexOf("Paste your Kaspa address")).toBeLessThan(open.indexOf("Prize secured"));
    expect(open).toContain("<summary>How it works</summary>");

    const drawn = render("drawn");
    expect(drawn).not.toContain("How it works");
    expect(drawn.indexOf("Prize secured")).toBeLessThan(drawn.indexOf("Prize paid automatically"));
  });

  it("replaces the entry form once every spot is taken", () => {
    const html = render("open", undefined, 12);

    expect(html).toContain("This giveaway is full");
    expect(html).toContain("All 12 spots are taken");
    expect(html).not.toContain("Join giveaway");
  });

  it("names no account for a giveaway started as a guest", () => {
    const html = renderToStaticMarkup(
      <V6GiveawayView
        amountKas="1"
        entryAvailable={true}
        closesAt={new Date("2026-10-11T12:00:00.000Z")}
        closesAtDaa="123456"
        lastSyncedAt={null}
        network="mainnet"
        publicId="cm12345678901234567890123"
        returnAtDaa="223456"
        snapshot={snapshot("open")}
        title="Community giveaway"
        turnstileSiteKey="site-key"
        transitionCount={2}
        username={null}
        verificationPaused={false}
        winnerAddress={null}
      />,
    );

    expect(html).toContain("created without an account");
    expect(html).not.toContain("@null");
  });
});
