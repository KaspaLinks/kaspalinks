-- Fixed Giveaway V6 draw slots. Additive: no existing table changes.
-- One row per network and slot start. The unique index is what keeps two
-- concurrent creations for the same slot from deriving different terms.

-- CreateTable
CREATE TABLE "GiveawayDrawSlot" (
    "id" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "closesAtDaa" BIGINT NOT NULL,
    "entropyTargetBlueScore" BIGINT NOT NULL,
    "returnAtDaa" BIGINT NOT NULL,
    "anchorDaa" BIGINT NOT NULL,
    "anchorBlueScore" BIGINT NOT NULL,
    "anchoredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayDrawSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDrawSlot_network_startsAt_key" ON "GiveawayDrawSlot"("network", "startsAt");
