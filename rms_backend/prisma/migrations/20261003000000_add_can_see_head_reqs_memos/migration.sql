-- Add sub-account visibility privilege columns to Department
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "canSeeHeadReqs"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "canSeeHeadMemos" BOOLEAN NOT NULL DEFAULT false;
