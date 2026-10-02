-- Recreate Notification table if it was lost from the VPS database.
-- Safe: IF NOT EXISTS means this is a no-op if the table already exists.
CREATE TABLE IF NOT EXISTS "public"."Notification" (
    "id"           SERIAL       NOT NULL,
    "userId"       INTEGER,
    "departmentId" INTEGER,
    "content"      TEXT         NOT NULL,
    "link"         TEXT,
    "isRead"       BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Foreign keys — also safe to add only if they don't exist yet
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey'
  ) THEN
    ALTER TABLE "public"."Notification"
      ADD CONSTRAINT "Notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_departmentId_fkey'
  ) THEN
    ALTER TABLE "public"."Notification"
      ADD CONSTRAINT "Notification_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
