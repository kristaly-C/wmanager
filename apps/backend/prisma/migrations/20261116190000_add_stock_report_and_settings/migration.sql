-- CreateEnum
CREATE TYPE "StockReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "boolValue" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StockReport" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "foundQuantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StockReportStatus" NOT NULL DEFAULT 'PENDING',
    "reportedByUserId" TEXT NOT NULL,
    "resolvedByUserId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockReport_locationId_status_idx" ON "StockReport"("locationId", "status");

-- CreateIndex
CREATE INDEX "StockReport_variantId_idx" ON "StockReport"("variantId");

-- CreateIndex
CREATE INDEX "StockReport_reportedByUserId_idx" ON "StockReport"("reportedByUserId");

-- AddForeignKey
ALTER TABLE "StockReport" ADD CONSTRAINT "StockReport_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReport" ADD CONSTRAINT "StockReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReport" ADD CONSTRAINT "StockReport_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReport" ADD CONSTRAINT "StockReport_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
