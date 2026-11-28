-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WEBSHOP', 'STORE', 'PHONE', 'B2B');

-- CreateEnum
CREATE TYPE "PickTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_DROP', 'COMPLETED', 'CANCELLED');

-- AlterEnum SalesOrderStatus (expand lifecycle statuses safely)
CREATE TYPE "SalesOrderStatus_new" AS ENUM ('ON_HOLD', 'PENDING', 'PICKING', 'READY', 'COMPLETED', 'CANCELLED');
ALTER TABLE "SalesOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "SalesOrder" ALTER COLUMN "status" TYPE "SalesOrderStatus_new" USING ("status"::text::"SalesOrderStatus_new");
ALTER TYPE "SalesOrderStatus" RENAME TO "SalesOrderStatus_old";
ALTER TYPE "SalesOrderStatus_new" RENAME TO "SalesOrderStatus";
DROP TYPE "SalesOrderStatus_old";
ALTER TABLE "SalesOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable SalesOrder
ALTER TABLE "SalesOrder"
    ADD COLUMN "orderNumber" TEXT,
    ADD COLUMN "externalOrderRef" TEXT,
    ADD COLUMN "channel" "SalesChannel" NOT NULL DEFAULT 'WEBSHOP',
    ADD COLUMN "sourceLocationId" TEXT,
    ADD COLUMN "transferRequestedFromLocationId" TEXT,
    ADD COLUMN "holdReason" TEXT,
    ADD COLUMN "customerName" TEXT,
    ADD COLUMN "customerEmail" TEXT,
    ADD COLUMN "customerPhone" TEXT,
    ADD COLUMN "shippingAddress" TEXT,
    ADD COLUMN "note" TEXT,
    ADD COLUMN "createdByUserId" TEXT,
    ADD COLUMN "completedByUserId" TEXT,
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "SalesOrder"
SET
    "orderNumber" = COALESCE("orderNumber", 'SO-LEGACY-' || "id"),
    "customerName" = COALESCE("customerName", 'Legacy vevő'),
    "sourceLocationId" = COALESCE(
        "sourceLocationId",
        (
            SELECT "id"
            FROM "Location"
            ORDER BY
                CASE
                    WHEN "type" IN ('WAREHOUSE', 'STORE') THEN 0
                    ELSE 1
                END,
                "createdAt" ASC
            LIMIT 1
        )
    )
WHERE "orderNumber" IS NULL
   OR "customerName" IS NULL
   OR "sourceLocationId" IS NULL;

ALTER TABLE "SalesOrder"
    ALTER COLUMN "orderNumber" SET NOT NULL,
    ALTER COLUMN "sourceLocationId" SET NOT NULL,
    ALTER COLUMN "customerName" SET NOT NULL;

-- AlterTable StockMovement
ALTER TABLE "StockMovement"
    ADD COLUMN "pickTaskId" TEXT;

-- CreateTable SalesOrderItem
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitNetPrice" DECIMAL(12,2) NOT NULL,
    "unitGrossPrice" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "discountPercent" DECIMAL(5,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable PickTask
CREATE TABLE "PickTask" (
    "id" TEXT NOT NULL,
    "taskNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "zoneId" TEXT,
    "status" "PickTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "toteCode" TEXT,
    "dropoffLocationId" TEXT,
    "dropoffCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable PickTaskItem
CREATE TABLE "PickTaskItem" (
    "id" TEXT NOT NULL,
    "pickTaskId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "suggestedLocationId" TEXT,
    "requiredQuantity" INTEGER NOT NULL,
    "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickTaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNumber_key" ON "SalesOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "SalesOrder_sourceLocationId_status_idx" ON "SalesOrder"("sourceLocationId", "status");

-- CreateIndex
CREATE INDEX "SalesOrder_status_createdAt_idx" ON "SalesOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrder_externalOrderRef_idx" ON "SalesOrder"("externalOrderRef");

-- CreateIndex
CREATE INDEX "SalesOrderItem_variantId_idx" ON "SalesOrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_salesOrderId_variantId_key" ON "SalesOrderItem"("salesOrderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PickTask_taskNumber_key" ON "PickTask"("taskNumber");

-- CreateIndex
CREATE INDEX "PickTask_salesOrderId_idx" ON "PickTask"("salesOrderId");

-- CreateIndex
CREATE INDEX "PickTask_sourceLocationId_status_idx" ON "PickTask"("sourceLocationId", "status");

-- CreateIndex
CREATE INDEX "PickTask_zoneId_status_idx" ON "PickTask"("zoneId", "status");

-- CreateIndex
CREATE INDEX "PickTask_assignedToUserId_status_idx" ON "PickTask"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "PickTaskItem_variantId_idx" ON "PickTaskItem"("variantId");

-- CreateIndex
CREATE INDEX "PickTaskItem_salesOrderItemId_idx" ON "PickTaskItem"("salesOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PickTaskItem_pickTaskId_salesOrderItemId_key" ON "PickTaskItem"("pickTaskId", "salesOrderItemId");

-- CreateIndex
CREATE INDEX "StockMovement_pickTaskId_idx" ON "StockMovement"("pickTaskId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_transferRequestedFromLocationId_fkey" FOREIGN KEY ("transferRequestedFromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTask" ADD CONSTRAINT "PickTask_dropoffLocationId_fkey" FOREIGN KEY ("dropoffLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTaskItem" ADD CONSTRAINT "PickTaskItem_pickTaskId_fkey" FOREIGN KEY ("pickTaskId") REFERENCES "PickTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTaskItem" ADD CONSTRAINT "PickTaskItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTaskItem" ADD CONSTRAINT "PickTaskItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickTaskItem" ADD CONSTRAINT "PickTaskItem_suggestedLocationId_fkey" FOREIGN KEY ("suggestedLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_pickTaskId_fkey" FOREIGN KEY ("pickTaskId") REFERENCES "PickTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
