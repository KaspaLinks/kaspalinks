-- Reviewed public setup for a SilverScript Giveaway V6 before its Kaspium
-- funding outpoint exists. Binding stores confirmed public chain facts only.

CREATE TYPE "GiveawayV6BootstrapStatus" AS ENUM (
  'AWAITING_FUNDING',
  'BOUND'
);

CREATE TABLE "GiveawayV6Bootstrap" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "network" "Network" NOT NULL,
  "status" "GiveawayV6BootstrapStatus" NOT NULL DEFAULT 'AWAITING_FUNDING',
  "compilerCommit" TEXT NOT NULL,
  "prizeSourceSha256" TEXT NOT NULL,
  "shardSourceSha256" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "familyTerms" JSONB NOT NULL,
  "prizeRedeemScriptHex" TEXT NOT NULL,
  "shardTemplateRedeemScriptHex" TEXT NOT NULL,
  "fundingScriptPublicKeyHex" TEXT NOT NULL,
  "fundingAddress" TEXT NOT NULL,
  "expectedFundingSompi" BIGINT NOT NULL,
  "fundingTransactionId" TEXT,
  "fundingOutputIndex" INTEGER,
  "fundingBlockDaaScore" BIGINT,
  "fundingAcceptingBlockHash" TEXT,
  "covenantIdHex" TEXT,
  "activationOutputs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiveawayV6Bootstrap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiveawayV6Bootstrap_giveawayId_key"
  ON "GiveawayV6Bootstrap"("giveawayId");
CREATE UNIQUE INDEX "GiveawayV6Bootstrap_fundingAddress_key"
  ON "GiveawayV6Bootstrap"("fundingAddress");
CREATE UNIQUE INDEX "GiveawayV6Bootstrap_covenantIdHex_key"
  ON "GiveawayV6Bootstrap"("covenantIdHex");
CREATE UNIQUE INDEX "GiveawayV6Bootstrap_fundingTransactionId_fundingOutputIndex_key"
  ON "GiveawayV6Bootstrap"("fundingTransactionId", "fundingOutputIndex");
CREATE INDEX "GiveawayV6Bootstrap_status_createdAt_idx"
  ON "GiveawayV6Bootstrap"("status", "createdAt");

ALTER TABLE "GiveawayV6Bootstrap"
  ADD CONSTRAINT "GiveawayV6Bootstrap_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
