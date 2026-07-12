-- Keep closed ClaimableLink rows as non-secret historical payment records so
-- public all-time totals cannot decrease when a creator removes a link from
-- My Links. The row contains no claim/refund private code.
ALTER TABLE "ClaimableLink" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "ClaimableLink_deletedAt_idx" ON "ClaimableLink"("deletedAt");
