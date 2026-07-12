ALTER TABLE "PaymentRequest"
ADD COLUMN "supporterName" TEXT,
ADD COLUMN "supporterPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supporterHiddenAt" TIMESTAMP(3);

CREATE INDEX "PaymentRequest_supporterPublic_idx" ON "PaymentRequest"("supporterPublic");
CREATE INDEX "PaymentRequest_supporterHiddenAt_idx" ON "PaymentRequest"("supporterHiddenAt");
CREATE INDEX "PaymentRequest_confirmedAt_idx" ON "PaymentRequest"("confirmedAt");
