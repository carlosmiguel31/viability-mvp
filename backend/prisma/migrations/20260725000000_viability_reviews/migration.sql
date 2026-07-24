-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_INFORMATION', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ReviewPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "ReviewEventType" AS ENUM ('CREATED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'DUE_DATE_CHANGED', 'NOTE_ADDED', 'RESOLVED', 'REOPENED');

-- CreateTable
CREATE TABLE "viability_reviews" (
    "id" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ReviewPriority" NOT NULL DEFAULT 'NORMAL',
    "openedById" UUID NOT NULL,
    "assignedToId" UUID,
    "resolutionCode" TEXT,
    "resolutionSummary" TEXT,
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viability_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "viability_review_events" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "actorId" UUID,
    "type" "ReviewEventType" NOT NULL,
    "fromStatus" "ReviewStatus",
    "toStatus" "ReviewStatus",
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viability_review_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "viability_reviews_consultationId_key" ON "viability_reviews"("consultationId");
CREATE INDEX "viability_reviews_status_idx" ON "viability_reviews"("status");
CREATE INDEX "viability_reviews_priority_idx" ON "viability_reviews"("priority");
CREATE INDEX "viability_reviews_assignedToId_idx" ON "viability_reviews"("assignedToId");
CREATE INDEX "viability_reviews_openedById_idx" ON "viability_reviews"("openedById");
CREATE INDEX "viability_reviews_dueAt_idx" ON "viability_reviews"("dueAt");
CREATE INDEX "viability_reviews_createdAt_idx" ON "viability_reviews"("createdAt");
CREATE INDEX "viability_reviews_updatedAt_idx" ON "viability_reviews"("updatedAt");
CREATE INDEX "viability_review_events_reviewId_idx" ON "viability_review_events"("reviewId");
CREATE INDEX "viability_review_events_actorId_idx" ON "viability_review_events"("actorId");
CREATE INDEX "viability_review_events_type_idx" ON "viability_review_events"("type");
CREATE INDEX "viability_review_events_createdAt_idx" ON "viability_review_events"("createdAt");

-- Foreign keys
ALTER TABLE "viability_reviews"
  ADD CONSTRAINT "viability_reviews_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "viability_consultations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "viability_reviews"
  ADD CONSTRAINT "viability_reviews_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "viability_reviews"
  ADD CONSTRAINT "viability_reviews_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "viability_review_events"
  ADD CONSTRAINT "viability_review_events_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "viability_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "viability_review_events"
  ADD CONSTRAINT "viability_review_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
