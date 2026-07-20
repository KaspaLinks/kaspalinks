-- Lab-only, non-custodial giveaway registrations and auditable one-time draws.
CREATE TYPE "GiveawayStatus" AS ENUM ('OPEN', 'DRAWN', 'NO_ENTRIES', 'CANCELLED');

CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountSompi" BIGINT NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "status" "GiveawayStatus" NOT NULL DEFAULT 'OPEN',
    "drawSeedHex" TEXT NOT NULL,
    "drawCommitment" TEXT NOT NULL,
    "drawDigest" TEXT,
    "winnerIndex" INTEGER,
    "winnerEntryId" TEXT,
    "winnerAddress" TEXT,
    "entryCountAtDraw" INTEGER,
    "drawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GiveawayEntry" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Giveaway_publicId_key" ON "Giveaway"("publicId");
CREATE INDEX "Giveaway_creatorId_idx" ON "Giveaway"("creatorId");
CREATE INDEX "Giveaway_status_idx" ON "Giveaway"("status");
CREATE INDEX "Giveaway_closesAt_idx" ON "Giveaway"("closesAt");
CREATE INDEX "Giveaway_createdAt_idx" ON "Giveaway"("createdAt");
CREATE UNIQUE INDEX "GiveawayEntry_giveawayId_address_key" ON "GiveawayEntry"("giveawayId", "address");
CREATE INDEX "GiveawayEntry_giveawayId_idx" ON "GiveawayEntry"("giveawayId");
CREATE INDEX "GiveawayEntry_createdAt_idx" ON "GiveawayEntry"("createdAt");

ALTER TABLE "Giveaway"
ADD CONSTRAINT "Giveaway_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GiveawayEntry"
ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey"
FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
