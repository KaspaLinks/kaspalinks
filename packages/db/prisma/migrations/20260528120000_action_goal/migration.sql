-- AlterEnum
-- Goal / crowdfunding link type. Additive enum value — existing rows are
-- untouched. Not used by any statement in this migration, so it is safe to
-- add inside the migration transaction on PostgreSQL 12+.
ALTER TYPE "ActionType" ADD VALUE 'kaspa.goal';

-- AlterTable
-- Fundraising target for KASPA_GOAL links. Nullable so every existing Action
-- (and all non-goal types going forward) keep NULL.
ALTER TABLE "Action" ADD COLUMN "goalSompi" BIGINT;
