ALTER TABLE "AgentIntentDraft" ADD COLUMN "sourceUpdateId" TEXT;
CREATE UNIQUE INDEX "AgentIntentDraft_sourceUpdateId_key" ON "AgentIntentDraft"("sourceUpdateId");
ALTER TABLE "Giveaway" ADD COLUMN "telegramCheckedAt" TIMESTAMP(3);
CREATE TABLE "TelegramGiveawaySubscription" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "giveawayId" TEXT NOT NULL,
 "telegramUserId" TEXT NOT NULL,
 "telegramChatId" TEXT NOT NULL,
 "revokedAt" TIMESTAMP(3),
 "resultQueuedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "TelegramGiveawaySubscription_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TelegramGiveawaySubscription_giveawayId_telegramUserId_key" ON "TelegramGiveawaySubscription"("giveawayId", "telegramUserId");
CREATE INDEX "TelegramGiveawaySubscription_telegramUserId_revokedAt_idx" ON "TelegramGiveawaySubscription"("telegramUserId", "revokedAt");
CREATE INDEX "TelegramGiveawaySubscription_resultQueuedAt_revokedAt_idx" ON "TelegramGiveawaySubscription"("resultQueuedAt", "revokedAt");
ALTER TABLE "TelegramOutbox" ADD COLUMN "subscriptionId" TEXT;
ALTER TABLE "TelegramOutbox" ADD CONSTRAINT "TelegramOutbox_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TelegramGiveawaySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TelegramOutbox_subscriptionId_idx" ON "TelegramOutbox"("subscriptionId");
