CREATE TABLE "EscrowPrototype" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "signerContextId" TEXT NOT NULL,
  "amountSompi" BIGINT NOT NULL,
  "feeSompi" BIGINT NOT NULL,
  "releaseAfter" BIGINT NOT NULL,
  "buyerPublicKey" TEXT NOT NULL,
  "sellerPublicKey" TEXT NOT NULL,
  "buyerAddress" TEXT NOT NULL,
  "sellerAddress" TEXT NOT NULL,
  "activeFundingAddress" TEXT NOT NULL,
  "frozenFundingAddress" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'awaiting_funding',
  "releaseTxId" TEXT,
  "refundTxId" TEXT,
  "claimTxId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscrowPrototype_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EscrowPrototype_activeFundingAddress_key" ON "EscrowPrototype"("activeFundingAddress");
CREATE UNIQUE INDEX "EscrowPrototype_frozenFundingAddress_key" ON "EscrowPrototype"("frozenFundingAddress");
CREATE UNIQUE INDEX "EscrowPrototype_creatorId_signerContextId_key" ON "EscrowPrototype"("creatorId", "signerContextId");
CREATE INDEX "EscrowPrototype_creatorId_createdAt_idx" ON "EscrowPrototype"("creatorId", "createdAt");
CREATE INDEX "EscrowPrototype_status_idx" ON "EscrowPrototype"("status");
ALTER TABLE "EscrowPrototype" ADD CONSTRAINT "EscrowPrototype_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
