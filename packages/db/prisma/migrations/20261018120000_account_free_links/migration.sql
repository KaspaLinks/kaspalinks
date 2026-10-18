-- Payment links and claimable links created without a KaspaLinks account.
-- A private manage link (only its SHA-256 is stored) lets the creator manage the
-- link, or adopt it into an account later. createdWithoutAccount keeps the origin
-- for statistics after adoption. Existing account-free claimable links are marked.
ALTER TABLE "Action" ADD COLUMN "manageTokenHash" TEXT;
ALTER TABLE "Action" ADD COLUMN "createdWithoutAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Action" ADD COLUMN "source" TEXT;
CREATE UNIQUE INDEX "Action_manageTokenHash_key" ON "Action"("manageTokenHash");
CREATE INDEX "Action_createdWithoutAccount_createdAt_idx" ON "Action"("createdWithoutAccount", "createdAt");

ALTER TABLE "ClaimableLink" ADD COLUMN "manageTokenHash" TEXT;
ALTER TABLE "ClaimableLink" ADD COLUMN "createdWithoutAccount" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ClaimableLink_manageTokenHash_key" ON "ClaimableLink"("manageTokenHash");
CREATE INDEX "ClaimableLink_createdWithoutAccount_createdAt_idx" ON "ClaimableLink"("createdWithoutAccount", "createdAt");

UPDATE "ClaimableLink" SET "createdWithoutAccount" = true WHERE "creatorId" IS NULL;
