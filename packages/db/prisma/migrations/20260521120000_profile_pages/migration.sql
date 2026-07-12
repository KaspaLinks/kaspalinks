-- Profile pages: Creator gets a public-facing /u/<username> landing with
-- a bio + a chosen tip Action + a list of their other public Actions.
--
-- Columns are additive and nullable / defaulted. Backfill updates only
-- profile visibility defaults and the initial quick-tip pointer.

-- 1. Creator gets a short bio + a foreign-key pointer to the Action that
--    represents the canonical "quick tip" target on their profile.
ALTER TABLE "Creator"
ADD COLUMN "bio"         TEXT,
ADD COLUMN "tipActionId" TEXT;

ALTER TABLE "Creator"
ADD CONSTRAINT "Creator_tipActionId_fkey"
  FOREIGN KEY ("tipActionId") REFERENCES "Action"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Creator_tipActionId_idx" ON "Creator"("tipActionId");

-- 2. Action gets an opt-out flag that hides it from the creator's public
--    profile list. Default false so existing tip + donation links show
--    up on the profile right away. The /new-link form will set this to
--    true for invoice / transfer types (smart per-type default in the
--    POST handler).
ALTER TABLE "Action"
ADD COLUMN "hiddenFromProfile" BOOLEAN NOT NULL DEFAULT false;

-- 3. Backfill: for every Creator that already has at least one
--    variable-amount kaspa.tip Action, pick the most recent one as the
--    default tipActionId. New creators get this auto-set on first link
--    create in the POST handler, but existing creators (i.e. you, on
--    your dev/prod data) should land on a working profile without
--    extra clicks.
UPDATE "Creator" c
SET "tipActionId" = sub.id
FROM (
  SELECT DISTINCT ON ("creatorId") "creatorId", "id"
  FROM "Action"
  WHERE "type" = 'kaspa.tip'
    AND "amountSompi" IS NULL
    AND "deletedAt" IS NULL
    AND "disabledAt" IS NULL
    AND "creatorId" IS NOT NULL
  ORDER BY "creatorId", "createdAt" DESC
) sub
WHERE c."id" = sub."creatorId"
  AND c."tipActionId" IS NULL;

-- 4. Existing invoice + transfer Actions probably leak private context
--    (1-customer-specific amounts/labels) — hide them from profile by
--    default. Tip + donation default to public, which matches the
--    column default above.
UPDATE "Action"
SET "hiddenFromProfile" = true
WHERE "type" IN ('kaspa.invoice', 'kaspa.transfer');
