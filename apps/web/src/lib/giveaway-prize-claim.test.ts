import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kaspa-actions/kaspa", () => ({
  buildKaspaAddressScriptPublicKeyHex: vi.fn(),
}));

vi.mock("./toccata-lab", () => ({
  readClaimableBroadcastSafeJsonSummary: vi.fn(),
  readClaimableSpendMode: vi.fn(),
  validateRegisteredClaimableMetadata: vi.fn(),
}));

import { buildKaspaAddressScriptPublicKeyHex } from "@kaspa-actions/kaspa";

import { verifyPreparedGiveawayPrizeClaim } from "./giveaway-prize-claim";
import {
  readClaimableBroadcastSafeJsonSummary,
  readClaimableSpendMode,
  validateRegisteredClaimableMetadata,
} from "./toccata-lab";

const buildAddressScriptMock = vi.mocked(buildKaspaAddressScriptPublicKeyHex);
const readBroadcastSummaryMock = vi.mocked(readClaimableBroadcastSafeJsonSummary);
const readSpendModeMock = vi.mocked(readClaimableSpendMode);
const validateMetadataMock = vi.mocked(validateRegisteredClaimableMetadata);

const link = {
  amountSompi: 100_200_000n,
  claimPublicKey: "11".repeat(32),
  feeSompi: 200_000n,
  fundingAddress: `kaspa:${"q".repeat(61)}`,
  fundingOutputIndex: 0,
  fundingTxId: "aa".repeat(32),
  redeemScriptHex: "51",
  refundLockTime: "100",
  refundPublicKey: "22".repeat(32),
  status: "funded",
};

describe("verifyPreparedGiveawayPrizeClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateMetadataMock.mockReturnValue({
      amountSompi: 100_200_000n,
      claimPublicKey: link.claimPublicKey,
      feeSompi: 200_000n,
      fundingAddress: link.fundingAddress,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      refundPublicKey: link.refundPublicKey,
    });
    readSpendModeMock.mockReturnValue("claim");
    buildAddressScriptMock.mockReturnValue("winner-script");
    readBroadcastSummaryMock.mockReturnValue({
      fundingAmountSompi: "100200000",
      fundingOutputIndex: 0,
      fundingTransactionId: link.fundingTxId,
      lockTime: "0",
      outputAmountSompi: "100000000",
      outputScriptPublicKeyHex: "winner-script",
      signatureScriptHex: "signature-script",
      transactionId: "bb".repeat(32),
    });
  });

  it("accepts a signed claim fixed to the selected winner", () => {
    expect(
      verifyPreparedGiveawayPrizeClaim({
        expectedTransactionId: "bb".repeat(32),
        link,
        transactionSafeJson: "{}",
        winnerAddress: `kaspa:${"p".repeat(61)}`,
      }).transactionId,
    ).toBe("bb".repeat(32));
  });

  it("rejects a transaction redirected to another output script", () => {
    readBroadcastSummaryMock.mockReturnValueOnce({
      fundingAmountSompi: "100200000",
      fundingOutputIndex: 0,
      fundingTransactionId: link.fundingTxId,
      lockTime: "0",
      outputAmountSompi: "100000000",
      outputScriptPublicKeyHex: "attacker-script",
      signatureScriptHex: "signature-script",
      transactionId: "bb".repeat(32),
    });

    expect(() =>
      verifyPreparedGiveawayPrizeClaim({
        expectedTransactionId: "bb".repeat(32),
        link,
        transactionSafeJson: "{}",
        winnerAddress: `kaspa:${"p".repeat(61)}`,
      }),
    ).toThrow(/selected winner address/);
  });

  it("rejects a prepared transaction with the wrong payout amount", () => {
    readBroadcastSummaryMock.mockReturnValueOnce({
      fundingAmountSompi: "100200000",
      fundingOutputIndex: 0,
      fundingTransactionId: link.fundingTxId,
      lockTime: "0",
      outputAmountSompi: "99999999",
      outputScriptPublicKeyHex: "winner-script",
      signatureScriptHex: "signature-script",
      transactionId: "bb".repeat(32),
    });

    expect(() =>
      verifyPreparedGiveawayPrizeClaim({
        expectedTransactionId: "bb".repeat(32),
        link,
        transactionSafeJson: "{}",
        winnerAddress: `kaspa:${"p".repeat(61)}`,
      }),
    ).toThrow(/wrong payout amount/);
  });
});
