CREATE TYPE "TelegramOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD');
CREATE TYPE "AgentIntentStatus" AS ENUM ('PENDING_CONFIRMATION', 'NEEDS_CLARIFICATION', 'EXECUTING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "NotificationRuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "NotificationRuleKind" AS ENUM ('ALL_PAYMENTS', 'ACTION', 'MINIMUM_AMOUNT', 'ACTION_MINIMUM_AMOUNT');

ALTER TABLE "Creator"
ADD COLUMN "defaultRecipientAddress" TEXT,
ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "telegramBetaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "agentAiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "agentAiConsentAt" TIMESTAMP(3),
ADD COLUMN "agentWaitlistAt" TIMESTAMP(3);

ALTER TABLE "Action"
ADD COLUMN "invoicePaidAt" TIMESTAMP(3),
ADD COLUMN "agentCommandKey" TEXT;

ALTER TABLE "PaymentRequest"
ADD COLUMN "detectionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextDetectionAt" TIMESTAMP(3);

CREATE TABLE "TelegramConnection" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "supporterDetailsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramConnectCode" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramConnectCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramConnectAttempt" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramConnectAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramUpdate" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "creatorId" TEXT,
    "amountSompi" BIGINT NOT NULL,
    "txId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramOutbox" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT,
    "connectionId" TEXT,
    "paymentEventId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "matchedRuleIds" JSONB,
    "status" "TelegramOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentIntentDraft" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AgentIntentStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentIntentDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "intent" TEXT,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentQuotaBucket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentQuotaBucket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "actionId" TEXT,
    "kind" "NotificationRuleKind" NOT NULL,
    "minimumSompi" BIGINT,
    "status" "NotificationRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "completeOnInvoicePayment" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramConnection_creatorId_key" ON "TelegramConnection"("creatorId");
CREATE UNIQUE INDEX "TelegramConnection_telegramUserId_key" ON "TelegramConnection"("telegramUserId");
CREATE UNIQUE INDEX "TelegramConnection_telegramChatId_key" ON "TelegramConnection"("telegramChatId");
CREATE INDEX "TelegramConnection_blockedAt_idx" ON "TelegramConnection"("blockedAt");
CREATE UNIQUE INDEX "TelegramConnectCode_codeHash_key" ON "TelegramConnectCode"("codeHash");
CREATE INDEX "TelegramConnectCode_creatorId_expiresAt_idx" ON "TelegramConnectCode"("creatorId", "expiresAt");
CREATE UNIQUE INDEX "TelegramConnectAttempt_telegramUserId_key" ON "TelegramConnectAttempt"("telegramUserId");
CREATE INDEX "TelegramConnectAttempt_blockedUntil_idx" ON "TelegramConnectAttempt"("blockedUntil");
CREATE UNIQUE INDEX "TelegramUpdate_updateId_key" ON "TelegramUpdate"("updateId");
CREATE INDEX "TelegramUpdate_processingAt_idx" ON "TelegramUpdate"("processingAt");
CREATE INDEX "TelegramUpdate_receivedAt_idx" ON "TelegramUpdate"("receivedAt");
CREATE UNIQUE INDEX "PaymentEvent_paymentRequestId_key" ON "PaymentEvent"("paymentRequestId");
CREATE INDEX "PaymentEvent_creatorId_occurredAt_idx" ON "PaymentEvent"("creatorId", "occurredAt");
CREATE INDEX "PaymentEvent_actionId_occurredAt_idx" ON "PaymentEvent"("actionId", "occurredAt");
CREATE INDEX "PaymentEvent_txId_idx" ON "PaymentEvent"("txId");
CREATE UNIQUE INDEX "TelegramOutbox_dedupeKey_key" ON "TelegramOutbox"("dedupeKey");
CREATE INDEX "TelegramOutbox_status_availableAt_idx" ON "TelegramOutbox"("status", "availableAt");
CREATE INDEX "TelegramOutbox_creatorId_createdAt_idx" ON "TelegramOutbox"("creatorId", "createdAt");
CREATE INDEX "TelegramOutbox_connectionId_idx" ON "TelegramOutbox"("connectionId");
CREATE INDEX "AgentIntentDraft_creatorId_status_idx" ON "AgentIntentDraft"("creatorId", "status");
CREATE INDEX "AgentIntentDraft_telegramUserId_expiresAt_idx" ON "AgentIntentDraft"("telegramUserId", "expiresAt");
CREATE INDEX "AiUsageEvent_creatorId_createdAt_idx" ON "AiUsageEvent"("creatorId", "createdAt");
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");
CREATE UNIQUE INDEX "AgentQuotaBucket_scope_scopeKey_periodKey_key" ON "AgentQuotaBucket"("scope", "scopeKey", "periodKey");
CREATE INDEX "AgentQuotaBucket_scope_periodKey_idx" ON "AgentQuotaBucket"("scope", "periodKey");
CREATE INDEX "NotificationRule_creatorId_status_idx" ON "NotificationRule"("creatorId", "status");
CREATE INDEX "NotificationRule_actionId_idx" ON "NotificationRule"("actionId");
CREATE INDEX "Action_invoicePaidAt_idx" ON "Action"("invoicePaidAt");
CREATE UNIQUE INDEX "Action_agentCommandKey_key" ON "Action"("agentCommandKey");
CREATE INDEX "PaymentRequest_status_nextDetectionAt_idx" ON "PaymentRequest"("status", "nextDetectionAt");

ALTER TABLE "TelegramConnection" ADD CONSTRAINT "TelegramConnection_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramConnectCode" ADD CONSTRAINT "TelegramConnectCode_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramOutbox" ADD CONSTRAINT "TelegramOutbox_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "TelegramConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramOutbox" ADD CONSTRAINT "TelegramOutbox_paymentEventId_fkey" FOREIGN KEY ("paymentEventId") REFERENCES "PaymentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentIntentDraft" ADD CONSTRAINT "AgentIntentDraft_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Action" action
SET "invoicePaidAt" = confirmed."confirmedAt"
FROM (
    SELECT "actionId", MIN("confirmedAt") AS "confirmedAt"
    FROM "PaymentRequest"
    WHERE "status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL
    GROUP BY "actionId"
) confirmed
WHERE action."id" = confirmed."actionId"
  AND action."type" = 'kaspa.invoice'
  AND action."invoicePaidAt" IS NULL;
