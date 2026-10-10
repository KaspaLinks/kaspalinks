-- Restart-safe public projection for SilverScript Giveaway V6.
-- This table stores only public configuration and chain-derived facts.

CREATE TYPE "GiveawayV6Phase" AS ENUM (
  'AWAITING_ACTIVATION',
  'OPEN',
  'FROZEN',
  'DRAWN',
  'RETURNED'
);

CREATE TABLE "GiveawayV6Projection" (
  "id" TEXT NOT NULL,
  "giveawayId" TEXT NOT NULL,
  "network" "Network" NOT NULL,
  "covenantIdHex" TEXT NOT NULL,
  "anchorHash" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "family" JSONB NOT NULL,
  "checkpoint" JSONB,
  "snapshot" JSONB NOT NULL,
  "phase" "GiveawayV6Phase" NOT NULL DEFAULT 'AWAITING_ACTIVATION',
  "observedRegistrationCount" INTEGER NOT NULL DEFAULT 0,
  "frozenEntryCount" INTEGER,
  "winnerScriptPublicKeyHex" TEXT,
  "terminalTransactionId" TEXT,
  "cursorHash" TEXT,
  "lastPageFingerprint" TEXT,
  "requiredHeaderHashes" JSONB,
  "syncRevision" INTEGER NOT NULL DEFAULT 0,
  "nextSyncAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiveawayV6Projection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiveawayV6Projection_giveawayId_key"
  ON "GiveawayV6Projection"("giveawayId");
CREATE UNIQUE INDEX "GiveawayV6Projection_covenantIdHex_key"
  ON "GiveawayV6Projection"("covenantIdHex");
CREATE UNIQUE INDEX "GiveawayV6Projection_terminalTransactionId_key"
  ON "GiveawayV6Projection"("terminalTransactionId");
CREATE INDEX "GiveawayV6Projection_phase_nextSyncAt_idx"
  ON "GiveawayV6Projection"("phase", "nextSyncAt");
CREATE INDEX "GiveawayV6Projection_nextSyncAt_idx"
  ON "GiveawayV6Projection"("nextSyncAt");

ALTER TABLE "GiveawayV6Projection"
  ADD CONSTRAINT "GiveawayV6Projection_giveawayId_fkey"
  FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
