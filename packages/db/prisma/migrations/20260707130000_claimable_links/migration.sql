-- CreateTable
CREATE TABLE "ClaimableLink" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "linkKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountSompi" BIGINT NOT NULL,
    "feeSompi" BIGINT NOT NULL,
    "fundingAddress" TEXT NOT NULL,
    "claimPublicKey" TEXT NOT NULL,
    "refundPublicKey" TEXT NOT NULL,
    "refundLockTime" TEXT NOT NULL,
    "redeemScriptHex" TEXT NOT NULL,
    "fundingTxId" TEXT,
    "fundingOutputIndex" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'awaiting_funding',
    "network" "Network" NOT NULL DEFAULT 'MAINNET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimableLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimableLink_creatorId_linkKey_key" ON "ClaimableLink"("creatorId", "linkKey");

-- CreateIndex
CREATE INDEX "ClaimableLink_creatorId_idx" ON "ClaimableLink"("creatorId");

-- CreateIndex
CREATE INDEX "ClaimableLink_status_idx" ON "ClaimableLink"("status");

-- CreateIndex
CREATE INDEX "ClaimableLink_fundingAddress_idx" ON "ClaimableLink"("fundingAddress");

-- AddForeignKey
ALTER TABLE "ClaimableLink" ADD CONSTRAINT "ClaimableLink_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
