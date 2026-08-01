-- A creator browser prepares a signed, fixed-destination prize transaction
-- after the draw. The server stores no signing key and can only relay the
-- already-signed transaction during the configured winner claim window.

ALTER TABLE "Giveaway"
  ADD COLUMN "winnerClaimWindowSeconds" INTEGER,
  ADD COLUMN "winnerClaimExpiresAt" TIMESTAMP(3),
  ADD COLUMN "prizeClaimPreparedAt" TIMESTAMP(3),
  ADD COLUMN "prizeClaimTransactionId" TEXT,
  ADD COLUMN "prizeClaimTransactionSafeJson" TEXT;

UPDATE "Giveaway"
SET "winnerClaimWindowSeconds" = 3600
WHERE "winnerClaimWindowSeconds" IS NULL;

CREATE UNIQUE INDEX "Giveaway_prizeClaimTransactionId_key"
  ON "Giveaway"("prizeClaimTransactionId");
