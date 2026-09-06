-- Preserve durable payment facts when their creator removes a profile.
ALTER TABLE "PaymentEvent" ALTER COLUMN "paymentRequestId" DROP NOT NULL;
ALTER TABLE "PaymentEvent" ALTER COLUMN "actionId" DROP NOT NULL;
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_paymentRequestId_fkey";
ALTER TABLE "PaymentEvent" DROP CONSTRAINT "PaymentEvent_actionId_fkey";
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentRequestId_fkey"
  FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_actionId_fkey"
  FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
