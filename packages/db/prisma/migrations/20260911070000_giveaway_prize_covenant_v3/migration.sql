-- Covenant-enforced giveaway prize (protocol v3).
--
-- Purely additive: every new Giveaway column is nullable, so existing rows stay
-- on protocol v2 and keep verifying exactly as before. The Creator flag gates
-- the feature while it is exercised on a single account.
--
-- The unique indexes sit on nullable columns, which Postgres permits for any
-- number of NULLs, so they constrain only rows that actually use the covenant.

-- CreateEnum
CREATE TYPE "GiveawayPrizeCovenantPhase" AS ENUM ('OPEN', 'FROZEN', 'SETTLED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "prizeCovenantEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Giveaway" ADD COLUMN     "prizeCovenantAddress" TEXT,
ADD COLUMN     "prizeCovenantClosesAtDaa" BIGINT,
ADD COLUMN     "prizeCovenantCreatorKey" TEXT,
ADD COLUMN     "prizeCovenantDrawFeeSompi" BIGINT,
ADD COLUMN     "prizeCovenantDrawTxId" TEXT,
ADD COLUMN     "prizeCovenantFreezeTxId" TEXT,
ADD COLUMN     "prizeCovenantPhase" "GiveawayPrizeCovenantPhase",
ADD COLUMN     "prizeCovenantPlatformKey" TEXT,
ADD COLUMN     "prizeCovenantRefundDaa" BIGINT,
ADD COLUMN     "prizeCovenantVersion" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_prizeCovenantAddress_key" ON "Giveaway"("prizeCovenantAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_prizeCovenantFreezeTxId_key" ON "Giveaway"("prizeCovenantFreezeTxId");

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_prizeCovenantDrawTxId_key" ON "Giveaway"("prizeCovenantDrawTxId");
