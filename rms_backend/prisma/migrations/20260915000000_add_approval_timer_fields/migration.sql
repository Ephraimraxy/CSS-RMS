-- Authority-tier response timers
-- Tracks how long HR / GM / CEO has been holding a request for final approval.
-- approvalTimerStartedAt: when the current tier's clock started
-- approvalTimerTier:      which tier is timed ('hr' | 'gm' | 'chairman')
-- approvalStalled:        true when CEO timer expires with nowhere to escalate

ALTER TABLE "Requisition"
  ADD COLUMN IF NOT EXISTS "approvalTimerStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalTimerTier"      TEXT,
  ADD COLUMN IF NOT EXISTS "approvalStalled"         BOOLEAN NOT NULL DEFAULT false;
