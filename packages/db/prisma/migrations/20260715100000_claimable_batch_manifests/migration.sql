CREATE TABLE "ClaimableBatch" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activationPublicKey" TEXT NOT NULL,
    "refundPublicKey" TEXT NOT NULL,
    "refundLockTime" TEXT NOT NULL,
    "fundingAddress" TEXT NOT NULL,
    "fundingAmountSompi" BIGINT NOT NULL,
    "activationFeeSompi" BIGINT NOT NULL,
    "redeemScriptHex" TEXT NOT NULL,
    "expectedOutputs" JSONB NOT NULL,
    "fundingTxId" TEXT,
    "fundingOutputIndex" INTEGER,
    "pendingActivationTxId" TEXT,
    "activationTxId" TEXT,
    "pendingRefundTxId" TEXT,
    "refundTxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_funding',
    "network" "Network" NOT NULL DEFAULT 'MAINNET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimableBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClaimableBatch_batchKey_key" ON "ClaimableBatch"("batchKey");
CREATE UNIQUE INDEX "ClaimableBatch_creatorId_batchKey_key" ON "ClaimableBatch"("creatorId", "batchKey");
CREATE INDEX "ClaimableBatch_creatorId_idx" ON "ClaimableBatch"("creatorId");
CREATE INDEX "ClaimableBatch_status_idx" ON "ClaimableBatch"("status");
CREATE INDEX "ClaimableBatch_fundingAddress_idx" ON "ClaimableBatch"("fundingAddress");

ALTER TABLE "ClaimableBatch"
ADD CONSTRAINT "ClaimableBatch_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
