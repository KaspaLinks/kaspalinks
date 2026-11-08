-- Group giveaways are posted only after the admin who set them up chooses "Post".
-- Additive: three nullable columns. Giveaways the bot already announced count as confirmed.
ALTER TABLE "TelegramGroupGiveaway" ADD COLUMN     "askQueuedAt" TIMESTAMP(3),
ADD COLUMN     "postConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "postDeclinedAt" TIMESTAMP(3);

UPDATE "TelegramGroupGiveaway" SET "postConfirmedAt" = "announceQueuedAt" WHERE "announceQueuedAt" IS NOT NULL;
