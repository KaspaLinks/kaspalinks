-- Creator-owned Actions, human-readable slugs, and creator audit context.
ALTER TYPE "AuditActorType" ADD VALUE IF NOT EXISTS 'CREATOR';

CREATE TABLE "Creator" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Creator_username_key" ON "Creator"("username");
CREATE INDEX "Creator_createdAt_idx" ON "Creator"("createdAt");

ALTER TABLE "Action" ADD COLUMN "creatorId" TEXT;
ALTER TABLE "Action" ADD COLUMN "slug" TEXT;

CREATE INDEX "Action_creatorId_idx" ON "Action"("creatorId");
CREATE INDEX "Action_slug_idx" ON "Action"("slug");
CREATE UNIQUE INDEX "Action_creatorId_slug_key" ON "Action"("creatorId", "slug");

ALTER TABLE "Action"
  ADD CONSTRAINT "Action_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD COLUMN "creatorId" TEXT;

CREATE INDEX "AuditLog_creatorId_idx" ON "AuditLog"("creatorId");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
