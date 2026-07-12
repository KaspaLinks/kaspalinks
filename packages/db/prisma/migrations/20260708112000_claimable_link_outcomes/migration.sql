-- Add optional outcome metadata for claimable links. These fields store only
-- public transaction ids and timestamps; claim/refund secret codes stay client-side.
ALTER TABLE "ClaimableLink"
  ADD COLUMN "claimTxId" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "refundTxId" TEXT,
  ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE INDEX "ClaimableLink_claimedAt_idx" ON "ClaimableLink"("claimedAt");
CREATE INDEX "ClaimableLink_refundedAt_idx" ON "ClaimableLink"("refundedAt");
