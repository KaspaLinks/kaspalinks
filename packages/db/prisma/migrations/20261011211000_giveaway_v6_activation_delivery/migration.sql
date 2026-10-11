-- Restart-safe delivery state for the deterministic keyless V6 activation.
-- No wallet, signing, recovery, or participant secret is stored here.

ALTER TABLE "GiveawayV6Bootstrap"
  ADD COLUMN "activationTransactionId" TEXT,
  ADD COLUMN "activationSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "activationLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "activationLastErrorCode" TEXT;

CREATE UNIQUE INDEX "GiveawayV6Bootstrap_activationTransactionId_key"
  ON "GiveawayV6Bootstrap"("activationTransactionId");
