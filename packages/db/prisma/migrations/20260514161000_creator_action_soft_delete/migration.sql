-- Soft-delete creator Actions without losing payment/audit history.
ALTER TABLE "Action" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Action_deletedAt_idx" ON "Action"("deletedAt");
