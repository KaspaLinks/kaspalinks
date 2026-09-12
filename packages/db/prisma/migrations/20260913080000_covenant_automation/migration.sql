ALTER TABLE "CovenantPrototype" ADD COLUMN "automationNextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "automationFinishedAt" TIMESTAMP(3);
CREATE INDEX "CovenantPrototype_automationFinishedAt_automationNextAt_idx" ON "CovenantPrototype"("automationFinishedAt", "automationNextAt");
