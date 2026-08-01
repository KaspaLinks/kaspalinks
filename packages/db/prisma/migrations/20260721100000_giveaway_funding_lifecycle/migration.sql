-- Start prize-backed giveaway entry windows only after funding is confirmed.
-- Existing unbacked giveaways remain open on their original schedule. Existing
-- funded prize giveaways preserve their original schedule; unfunded ones wait
-- for the normal on-chain reconciliation path.

ALTER TABLE "Giveaway" ADD COLUMN "entryWindowSeconds" INTEGER;
ALTER TABLE "Giveaway" ADD COLUMN "openedAt" TIMESTAMP(3);

UPDATE "Giveaway"
SET "entryWindowSeconds" = GREATEST(
      30,
      LEAST(604800, CEIL(EXTRACT(EPOCH FROM ("closesAt" - "createdAt")))::INTEGER)
    ),
    "openedAt" = CASE
      WHEN "prizeLinkKey" IS NULL THEN "createdAt"
      WHEN EXISTS (
        SELECT 1
        FROM "ClaimableLink"
        WHERE "ClaimableLink"."linkKey" = "Giveaway"."prizeLinkKey"
          AND "ClaimableLink"."fundingTxId" IS NOT NULL
          AND "ClaimableLink"."status" IN ('funded', 'shared')
      ) THEN "createdAt"
      ELSE NULL
    END;
