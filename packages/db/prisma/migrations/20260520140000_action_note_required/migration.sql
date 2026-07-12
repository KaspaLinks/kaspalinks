-- Add Action.noteRequired so creators can flag a link that demands a
-- supporter note before the Pay button enables. Default false keeps every
-- existing action unaffected.

ALTER TABLE "Action"
ADD COLUMN "noteRequired" BOOLEAN NOT NULL DEFAULT false;
