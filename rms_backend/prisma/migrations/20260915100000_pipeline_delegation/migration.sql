-- Pipeline stage tracking: when a request arrived at its current department
ALTER TABLE "Requisition"
  ADD COLUMN IF NOT EXISTS "currentDeptArrivedAt" TIMESTAMP(3);

-- Priority change trail: every urgency change on a request
CREATE TABLE IF NOT EXISTS "PriorityChangeLog" (
  "id"                SERIAL PRIMARY KEY,
  "requisitionId"     INTEGER NOT NULL,
  "changedByDeptId"   INTEGER,
  "changedByDeptName" TEXT,
  "changedByName"     TEXT,
  "fromUrgency"       TEXT NOT NULL,
  "toUrgency"         TEXT NOT NULL,
  "reason"            TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriorityChangeLog_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Internal dept delegation: head assigns request to sub-account to work on
CREATE TABLE IF NOT EXISTS "DeptAssignment" (
  "id"                     SERIAL PRIMARY KEY,
  "requisitionId"          INTEGER NOT NULL,
  "assignedByDeptId"       INTEGER NOT NULL,
  "assignedToSubDeptId"    INTEGER NOT NULL,
  "assignedByName"         TEXT,
  "assignedToName"         TEXT,
  "instruction"            TEXT,
  "status"                 TEXT NOT NULL DEFAULT 'active',
  "submissionNote"         TEXT,
  "submissionAttachments"  TEXT,
  "submittedAt"            TIMESTAMP(3),
  "confirmedByName"        TEXT,
  "confirmedAt"            TIMESTAMP(3),
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeptAssignment_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeptAssignment_assignedByDeptId_fkey"
    FOREIGN KEY ("assignedByDeptId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeptAssignment_assignedToSubDeptId_fkey"
    FOREIGN KEY ("assignedToSubDeptId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
