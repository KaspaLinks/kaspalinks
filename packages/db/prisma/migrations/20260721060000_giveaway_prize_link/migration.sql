-- Optional prize escrow for giveaways.
--
-- The prize is parked in an existing ClaimableLink whose claim code never
-- leaves the creator's browser. This only records which link belongs to which
-- giveaway; no key material is stored here.
--
-- Additive and nullable: existing giveaways keep working untouched.

ALTER TABLE "Giveaway" ADD COLUMN "prizeLinkKey" TEXT;

CREATE UNIQUE INDEX "Giveaway_prizeLinkKey_key" ON "Giveaway"("prizeLinkKey");

-- Deleting the claimable link must not delete the giveaway record; the draw
-- and its published proof stay verifiable either way.
ALTER TABLE "Giveaway"
  ADD CONSTRAINT "Giveaway_prizeLinkKey_fkey"
  FOREIGN KEY ("prizeLinkKey") REFERENCES "ClaimableLink"("linkKey")
  ON DELETE SET NULL ON UPDATE CASCADE;
