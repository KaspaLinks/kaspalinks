-- Telegram groups the bot was added to, and giveaways an admin announces there.
-- Purely additive: two new tables, no change to existing rows.

-- CreateTable
CREATE TABLE "TelegramGroup" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT,
    "welcomedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramGroupGiveaway" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "linkedByTelegramUserId" TEXT NOT NULL,
    "announceQueuedAt" TIMESTAMP(3),
    "reminderQueuedAt" TIMESTAMP(3),
    "resultQueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramGroupGiveaway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroup_chatId_key" ON "TelegramGroup"("chatId");

-- CreateIndex
CREATE INDEX "TelegramGroup_removedAt_idx" ON "TelegramGroup"("removedAt");

-- CreateIndex
CREATE INDEX "TelegramGroupGiveaway_giveawayId_idx" ON "TelegramGroupGiveaway"("giveawayId");

-- CreateIndex
CREATE INDEX "TelegramGroupGiveaway_resultQueuedAt_idx" ON "TelegramGroupGiveaway"("resultQueuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroupGiveaway_groupId_giveawayId_key" ON "TelegramGroupGiveaway"("groupId", "giveawayId");

-- AddForeignKey
ALTER TABLE "TelegramGroupGiveaway" ADD CONSTRAINT "TelegramGroupGiveaway_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TelegramGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramGroupGiveaway" ADD CONSTRAINT "TelegramGroupGiveaway_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

