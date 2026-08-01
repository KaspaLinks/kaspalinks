-- Giveaway draw protocol v2 freezes the participant set before a future
-- Kaspa virtual-chain block can exist, then derives the winner from that
-- block hash. Existing giveaways remain protocol v1 and continue to verify
-- with their original proof.

ALTER TABLE "Giveaway"
  ADD COLUMN "drawProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "entriesRoot" TEXT,
  ADD COLUMN "entriesFrozenAt" TIMESTAMP(3),
  ADD COLUMN "entropyTargetBlueScore" BIGINT,
  ADD COLUMN "entropyBlockBlueScore" BIGINT,
  ADD COLUMN "entropyBlockHash" TEXT;

