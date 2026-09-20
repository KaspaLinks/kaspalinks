CREATE TABLE "EscrowLinkPrototype" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "signerContextId" TEXT NOT NULL,
  "amountSompi" BIGINT NOT NULL,
  "feeSompi" BIGINT NOT NULL,
  "durationDaa" BIGINT NOT NULL,
  "sellerPublicKey" TEXT NOT NULL,
  "sellerAddress" TEXT NOT NULL,
  "buyerPublicKey" TEXT,
  "buyerAddress" TEXT,
  "releaseAfter" BIGINT,
  "activeFundingAddress" TEXT,
  "frozenFundingAddress" TEXT,
  "status" TEXT NOT NULL DEFAULT 'awaiting_buyer',
  "joinedAt" TIMESTAMP(3),
  "releaseTxId" TEXT,
  "refundTxId" TEXT,
  "claimTxId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscrowLinkPrototype_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EscrowLinkPrototype_publicId_key" ON "EscrowLinkPrototype"("publicId");
CREATE UNIQUE INDEX "EscrowLinkPrototype_activeFundingAddress_key" ON "EscrowLinkPrototype"("activeFundingAddress");
CREATE UNIQUE INDEX "EscrowLinkPrototype_frozenFundingAddress_key" ON "EscrowLinkPrototype"("frozenFundingAddress");
CREATE UNIQUE INDEX "EscrowLinkPrototype_creatorId_signerContextId_key" ON "EscrowLinkPrototype"("creatorId", "signerContextId");
CREATE INDEX "EscrowLinkPrototype_creatorId_createdAt_idx" ON "EscrowLinkPrototype"("creatorId", "createdAt");
CREATE INDEX "EscrowLinkPrototype_status_idx" ON "EscrowLinkPrototype"("status");
ALTER TABLE "EscrowLinkPrototype" ADD CONSTRAINT "EscrowLinkPrototype_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
