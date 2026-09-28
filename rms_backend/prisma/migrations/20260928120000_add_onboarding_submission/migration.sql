-- CreateTable: Staff self-service onboarding submissions (awaiting admin review)
CREATE TABLE "OnboardingSubmission" (
    "id"              TEXT          NOT NULL,
    "staffId"         TEXT          NOT NULL,
    "surname"         TEXT          NOT NULL,
    "firstName"       TEXT          NOT NULL,
    "middleName"      TEXT,
    "phone"           TEXT          NOT NULL,
    "personalEmail"   TEXT          NOT NULL,
    "officialEmail"   TEXT          NOT NULL,
    "deptId"          INTEGER,
    "deptName"        TEXT,
    "customDeptName"  TEXT,
    "role"            TEXT          NOT NULL DEFAULT 'MEMBER',
    "status"          TEXT          NOT NULL DEFAULT 'PENDING',
    "rejectionNote"   TEXT,
    "submittedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt"     TIMESTAMP(3),
    "processedByName" TEXT,
    CONSTRAINT "OnboardingSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingSubmission_staffId_key"     ON "OnboardingSubmission"("staffId");
CREATE UNIQUE INDEX "OnboardingSubmission_personalEmail_key" ON "OnboardingSubmission"("personalEmail");
CREATE UNIQUE INDEX "OnboardingSubmission_phone_key"        ON "OnboardingSubmission"("phone");

