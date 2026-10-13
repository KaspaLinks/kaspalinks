CREATE TYPE "GiveawayV6TransitionKind" AS ENUM ('FREEZE', 'DRAW', 'RETURN');

ALTER TABLE "GiveawayV6Projection"
  ADD COLUMN "executionNextAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "executionLeaseRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "executionLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "executionLastErrorCode" TEXT;

CREATE TABLE "GiveawayV6TransitionDelivery" (
  "id" TEXT NOT NULL,
  "projectionId" TEXT NOT NULL,
  "kind" "GiveawayV6TransitionKind" NOT NULL,
  "transactionId" TEXT NOT NULL,
  "transactionSafeJson" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GiveawayV6TransitionDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiveawayV6TransitionDelivery_transactionId_key"
  ON "GiveawayV6TransitionDelivery"("transactionId");
CREATE INDEX "GiveawayV6TransitionDelivery_projectionId_kind_createdAt_idx"
  ON "GiveawayV6TransitionDelivery"("projectionId", "kind", "createdAt");
CREATE INDEX "GiveawayV6TransitionDelivery_submittedAt_idx"
  ON "GiveawayV6TransitionDelivery"("submittedAt");
CREATE INDEX "GiveawayV6Projection_phase_executionNextAt_idx"
  ON "GiveawayV6Projection"("phase", "executionNextAt");

ALTER TABLE "GiveawayV6TransitionDelivery"
  ADD CONSTRAINT "GiveawayV6TransitionDelivery_projectionId_fkey"
  FOREIGN KEY ("projectionId") REFERENCES "GiveawayV6Projection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
