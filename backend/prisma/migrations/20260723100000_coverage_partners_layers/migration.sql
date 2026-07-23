-- CreateEnum
CREATE TYPE "CoverageFileType" AS ENUM ('KML', 'KMZ');
CREATE TYPE "CoverageProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "coverage_partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "coverage_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coverage_layers" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileType" "CoverageFileType" NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "processingStatus" "CoverageProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "polygonCount" INTEGER NOT NULL DEFAULT 0,
    "areaCount" INTEGER NOT NULL DEFAULT 0,
    "ignoredGeometryCount" INTEGER NOT NULL DEFAULT 0,
    "processingError" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coverage_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coverage_partners_code_key" ON "coverage_partners"("code");
CREATE UNIQUE INDEX "coverage_layers_storedFileName_key" ON "coverage_layers"("storedFileName");
CREATE UNIQUE INDEX "coverage_layers_sha256_key" ON "coverage_layers"("sha256");
CREATE INDEX "coverage_layers_partnerId_idx" ON "coverage_layers"("partnerId");
CREATE INDEX "coverage_layers_active_processingStatus_idx" ON "coverage_layers"("active", "processingStatus");

-- AddForeignKey
ALTER TABLE "coverage_partners" ADD CONSTRAINT "coverage_partners_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_partners" ADD CONSTRAINT "coverage_partners_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coverage_layers" ADD CONSTRAINT "coverage_layers_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "coverage_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coverage_layers" ADD CONSTRAINT "coverage_layers_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
