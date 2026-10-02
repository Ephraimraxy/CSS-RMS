-- Add canOverride column to Department table.
-- Grants selected departments the ability to restore rejected requisitions to pending.
-- Default false: no department has this privilege unless explicitly granted by Super Admin.
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "canOverride" BOOLEAN NOT NULL DEFAULT false;
