-- Part-payment discount fields: Account can file a discount (written-off balance)
-- with a reason; a configured verifier dept must confirm before the request closes.
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountAmount" DOUBLE PRECISION;
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountReason" TEXT;
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountStatus" TEXT;
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountVerifierDeptId" INTEGER;
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountRequestedAt" TIMESTAMP(3);
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "discountVerifiedAt" TIMESTAMP(3);
