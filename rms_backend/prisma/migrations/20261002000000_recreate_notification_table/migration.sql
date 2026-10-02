-- Recreate Notification table if it was lost from the VPS database.
-- Safe: IF NOT EXISTS is a no-op when the table already exists (Railway).
-- FK constraints are added only if the table was just created.
CREATE TABLE IF NOT EXISTS "public"."Notification" (
    "id"           SERIAL       NOT NULL,
    "userId"       INTEGER,
    "departmentId" INTEGER,
    "content"      TEXT         NOT NULL,
    "link"         TEXT,
    "isRead"       BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey"          PRIMARY KEY ("id"),
    CONSTRAINT "Notification_userId_fkey"   FOREIGN KEY ("userId")
        REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_departmentId_fkey" FOREIGN KEY ("departmentId")
        REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
