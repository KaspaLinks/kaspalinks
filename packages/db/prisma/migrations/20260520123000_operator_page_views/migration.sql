CREATE TABLE "OperatorPageView" (
    "id" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "visitorDayHash" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "utmSource" TEXT,
    "countryCode" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorPageView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorPageView_eventHash_key" ON "OperatorPageView"("eventHash");
CREATE INDEX "OperatorPageView_seenAt_idx" ON "OperatorPageView"("seenAt");
CREATE INDEX "OperatorPageView_visitorDayHash_idx" ON "OperatorPageView"("visitorDayHash");
CREATE INDEX "OperatorPageView_path_idx" ON "OperatorPageView"("path");
CREATE INDEX "OperatorPageView_referrer_idx" ON "OperatorPageView"("referrer");
CREATE INDEX "OperatorPageView_utmSource_idx" ON "OperatorPageView"("utmSource");
CREATE INDEX "OperatorPageView_countryCode_idx" ON "OperatorPageView"("countryCode");
CREATE INDEX "OperatorPageView_device_idx" ON "OperatorPageView"("device");
CREATE INDEX "OperatorPageView_browser_idx" ON "OperatorPageView"("browser");
CREATE INDEX "OperatorPageView_isBot_idx" ON "OperatorPageView"("isBot");
