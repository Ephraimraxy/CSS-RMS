-- Add isSelfApproved flag for department self-approval feature
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "isSelfApproved" BOOLEAN NOT NULL DEFAULT false;
