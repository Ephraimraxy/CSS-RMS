-- Add canRecall privilege column to Department
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "canRecall" BOOLEAN NOT NULL DEFAULT false;
