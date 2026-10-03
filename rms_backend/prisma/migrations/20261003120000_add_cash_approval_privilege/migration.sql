-- Separate cash approval/handling privilege from cash creation privilege
ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "cashApprovalPrivilege" BOOLEAN NOT NULL DEFAULT false;
