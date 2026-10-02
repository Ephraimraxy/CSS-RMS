-- Add canReject column to Department table.
-- Grants selected departments the ability to reject requisitions they receive.
-- Default false: no department has this privilege unless explicitly granted by Super Admin.
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "canReject" BOOLEAN NOT NULL DEFAULT false;
