CREATE TYPE "CreatorAccountKind" AS ENUM ('REGISTERED', 'TELEGRAM_ONLY');

ALTER TABLE "Creator"
ADD COLUMN "accountKind" "CreatorAccountKind" NOT NULL DEFAULT 'REGISTERED';

CREATE INDEX "Creator_accountKind_idx" ON "Creator"("accountKind");
