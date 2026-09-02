-- Track when the last priority escalation alert was sent for each request
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "priorityEscalatedAt" TIMESTAMP(3);
