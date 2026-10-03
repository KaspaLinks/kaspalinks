-- Claimable links v2 (docs/adr/0007): keyless auto-return to a committed address,
-- and links created without a KaspaLinks account. Existing rows keep scriptVersion 1,
-- their creator and their refund key; nothing is rewritten.
ALTER TABLE "ClaimableLink" ALTER COLUMN "creatorId" DROP NOT NULL;
ALTER TABLE "ClaimableLink" ALTER COLUMN "refundPublicKey" DROP NOT NULL;

ALTER TABLE "ClaimableLink" ADD COLUMN "scriptVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ClaimableLink" ADD COLUMN "returnAddress" TEXT;
ALTER TABLE "ClaimableLink" ADD COLUMN "source" TEXT;

CREATE INDEX "ClaimableLink_scriptVersion_status_idx" ON "ClaimableLink"("scriptVersion", "status");
