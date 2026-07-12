-- Remove the opt-in public Action registry flag.
DROP INDEX IF EXISTS "Action_listed_idx";
ALTER TABLE "Action" DROP COLUMN IF EXISTS "listed";
