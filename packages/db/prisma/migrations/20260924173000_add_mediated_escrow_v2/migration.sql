CREATE TABLE "MediatedEscrowPrototype" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "signerContextId" TEXT NOT NULL,
  "contractTemplateHash" TEXT NOT NULL,
  "amountSompi" BIGINT NOT NULL,
  "feeSompi" BIGINT NOT NULL,
  "claimDelayDaa" BIGINT NOT NULL,
  "fallbackDelayDaa" BIGINT NOT NULL,
  "sellerPublicKey" TEXT NOT NULL,
  "sellerAddress" TEXT NOT NULL,
  "mediatorLabel" TEXT NOT NULL,
  "mediatorPublicKey" TEXT,
  "buyerPublicKey" TEXT,
  "buyerAddress" TEXT,
  "activeFundingAddress" TEXT,
  "frozenFundingAddress" TEXT,
  "status" TEXT NOT NULL DEFAULT 'awaiting_mediator',
  "mediatorJoinedAt" TIMESTAMP(3),
  "buyerJoinedAt" TIMESTAMP(3),
  "releaseTxId" TEXT,
  "refundTxId" TEXT,
  "claimTxId" TEXT,
  "freezeTxId" TEXT,
  "agreementTxId" TEXT,
  "arbitrationTxId" TEXT,
  "fallbackTxId" TEXT,
  "pendingTransactionJson" TEXT,
  "pendingMode" TEXT,
  "pendingBuyerShare" BIGINT,
  "pendingMediatorParty" TEXT,
  "pendingCreatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediatedEscrowPrototype_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediatedEscrowPrototype_publicId_key" ON "MediatedEscrowPrototype"("publicId");
CREATE UNIQUE INDEX "MediatedEscrowPrototype_activeFundingAddress_key" ON "MediatedEscrowPrototype"("activeFundingAddress");
CREATE UNIQUE INDEX "MediatedEscrowPrototype_frozenFundingAddress_key" ON "MediatedEscrowPrototype"("frozenFundingAddress");
CREATE UNIQUE INDEX "MediatedEscrowPrototype_creatorId_signerContextId_key" ON "MediatedEscrowPrototype"("creatorId", "signerContextId");
CREATE INDEX "MediatedEscrowPrototype_creatorId_createdAt_idx" ON "MediatedEscrowPrototype"("creatorId", "createdAt");
CREATE INDEX "MediatedEscrowPrototype_status_idx" ON "MediatedEscrowPrototype"("status");
ALTER TABLE "MediatedEscrowPrototype" ADD CONSTRAINT "MediatedEscrowPrototype_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
