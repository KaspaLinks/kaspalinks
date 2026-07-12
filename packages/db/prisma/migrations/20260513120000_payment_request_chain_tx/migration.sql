-- AlterTable
ALTER TABLE "PaymentRequest"
    ADD COLUMN "txId" TEXT,
    ADD COLUMN "detectionSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_txId_key" ON "PaymentRequest"("txId");
