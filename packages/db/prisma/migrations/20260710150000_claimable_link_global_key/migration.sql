-- Public claim URLs and the transaction relay resolve claimable links without
-- creator context. A global key prevents ambiguous metadata or relay binding.
CREATE UNIQUE INDEX "ClaimableLink_linkKey_key" ON "ClaimableLink"("linkKey");
