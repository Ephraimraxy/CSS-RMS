-- CreateTable: persisted JWT revocation list
-- Keeps logout effective across server restarts.
-- tokenHash = SHA-256 of the raw JWT (never store the token itself).
-- expiresAt matches the token's own exp so rows are self-expiring.

CREATE TABLE IF NOT EXISTS "RevokedToken" (
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX IF NOT EXISTS "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");
