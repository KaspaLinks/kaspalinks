-- AlterTable
ALTER TABLE "Action" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Action_listed_idx" ON "Action"("listed");
