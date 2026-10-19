-- Telegram bot usage stats. Each update keeps a coarse label from a fixed list
-- ("/claim", "button:menu", "text"), never the message text; each chat keeps
-- only the time of its last activity.
ALTER TABLE "TelegramUpdate" ADD COLUMN "label" TEXT;
ALTER TABLE "TelegramConnection" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
CREATE INDEX "TelegramConnection_lastActiveAt_idx" ON "TelegramConnection"("lastActiveAt");
