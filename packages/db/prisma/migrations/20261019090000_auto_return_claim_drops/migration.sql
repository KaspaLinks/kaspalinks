-- Claim Drops without a refund key (scriptVersion 2). Child links are v2 links;
-- an allocator that is never activated returns keylessly to returnAddress after
-- the lock time, paying at most returnFeeSompi. Existing drops stay version 1.
ALTER TABLE "ClaimableBatch" ALTER COLUMN "refundPublicKey" DROP NOT NULL;
ALTER TABLE "ClaimableBatch" ADD COLUMN "scriptVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ClaimableBatch" ADD COLUMN "returnAddress" TEXT;
ALTER TABLE "ClaimableBatch" ADD COLUMN "returnFeeSompi" BIGINT;
CREATE INDEX "ClaimableBatch_scriptVersion_status_idx" ON "ClaimableBatch"("scriptVersion", "status");
