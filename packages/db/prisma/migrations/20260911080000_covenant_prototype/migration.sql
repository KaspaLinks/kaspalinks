CREATE TABLE "CovenantPrototype" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "fundingAddress" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "entropy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CovenantPrototype_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CovenantPrototype_fundingAddress_key" ON "CovenantPrototype"("fundingAddress");
CREATE INDEX "CovenantPrototype_creatorId_createdAt_idx" ON "CovenantPrototype"("creatorId", "createdAt");
ALTER TABLE "CovenantPrototype" ADD CONSTRAINT "CovenantPrototype_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
