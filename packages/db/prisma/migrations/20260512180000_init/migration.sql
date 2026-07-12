-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('kaspa.transfer', 'kaspa.tip', 'kaspa.donation', 'kaspa.invoice');

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('MAINNET', 'TESTNET');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'ADMIN', 'PUBLIC', 'DEMO');

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "type" "ActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recipientAddress" TEXT NOT NULL,
    "amountSompi" BIGINT NOT NULL,
    "message" TEXT,
    "network" "Network" NOT NULL DEFAULT 'MAINNET',
    "expiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "recipientAddress" TEXT NOT NULL,
    "amountSompi" BIGINT NOT NULL,
    "network" "Network" NOT NULL,
    "paymentUri" TEXT,
    "requestedMessage" TEXT,
    "fakeTxId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actionId" TEXT,
    "paymentRequestId" TEXT,
    "event" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'SYSTEM',
    "metadata" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Action_publicId_key" ON "Action"("publicId");

-- CreateIndex
CREATE INDEX "Action_type_idx" ON "Action"("type");

-- CreateIndex
CREATE INDEX "Action_recipientAddress_idx" ON "Action"("recipientAddress");

-- CreateIndex
CREATE INDEX "Action_expiresAt_idx" ON "Action"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_fakeTxId_key" ON "PaymentRequest"("fakeTxId");

-- CreateIndex
CREATE INDEX "PaymentRequest_actionId_idx" ON "PaymentRequest"("actionId");

-- CreateIndex
CREATE INDEX "PaymentRequest_status_idx" ON "PaymentRequest"("status");

-- CreateIndex
CREATE INDEX "PaymentRequest_expiresAt_idx" ON "PaymentRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_actionId_idx" ON "AuditLog"("actionId");

-- CreateIndex
CREATE INDEX "AuditLog_paymentRequestId_idx" ON "AuditLog"("paymentRequestId");

-- CreateIndex
CREATE INDEX "AuditLog_event_idx" ON "AuditLog"("event");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
