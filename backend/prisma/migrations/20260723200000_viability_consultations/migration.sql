-- CreateTable
CREATE TABLE "viability_consultations" (
    "id" UUID NOT NULL,
    "protocol" TEXT NOT NULL,
    "userId" UUID,
    "status" TEXT NOT NULL,
    "resultMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "postalCode" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "geocodingProvider" TEXT NOT NULL,
    "geocodedAddress" TEXT,
    "geocodingConfidence" TEXT,
    "geocodingLocationType" TEXT,
    "geocodingPartialMatch" BOOLEAN NOT NULL DEFAULT false,
    "geocodedLatitude" DOUBLE PRECISION,
    "geocodedLongitude" DOUBLE PRECISION,
    "confirmedLatitude" DOUBLE PRECISION,
    "confirmedLongitude" DOUBLE PRECISION,
    "locationConfirmedManually" BOOLEAN NOT NULL DEFAULT false,
    "confirmationRequired" BOOLEAN NOT NULL DEFAULT false,
    "coverageMatches" JSONB NOT NULL,
    "coverageMatchCount" INTEGER NOT NULL DEFAULT 0,
    "coverageConfigured" BOOLEAN NOT NULL DEFAULT false,
    "coverageSnapshotBuiltAt" TIMESTAMP(3),
    "networkReferenceStatus" TEXT NOT NULL,
    "networkReference" JSONB,
    "networkAlternatives" JSONB NOT NULL,
    "networkSearchRadiusMeters" INTEGER,
    "requestId" TEXT,
    "source" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "viability_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "viability_consultations_protocol_key" ON "viability_consultations"("protocol");
CREATE INDEX "viability_consultations_createdAt_idx" ON "viability_consultations"("createdAt");
CREATE INDEX "viability_consultations_userId_idx" ON "viability_consultations"("userId");
CREATE INDEX "viability_consultations_status_idx" ON "viability_consultations"("status");
CREATE INDEX "viability_consultations_postalCode_idx" ON "viability_consultations"("postalCode");
CREATE INDEX "viability_consultations_city_idx" ON "viability_consultations"("city");
CREATE INDEX "viability_consultations_state_idx" ON "viability_consultations"("state");
CREATE INDEX "viability_consultations_networkReferenceStatus_idx" ON "viability_consultations"("networkReferenceStatus");

-- AddForeignKey
ALTER TABLE "viability_consultations" ADD CONSTRAINT "viability_consultations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
