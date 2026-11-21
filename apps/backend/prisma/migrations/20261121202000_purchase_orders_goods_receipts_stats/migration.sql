-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'CANCELLED');

-- AlterEnum PurchaseOrderStatus (replace PENDING with full lifecycle statuses safely)
CREATE TYPE "PurchaseOrderStatus_new" AS ENUM ('DRAFT', 'ORDERED', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new" USING (
    CASE
        WHEN "status"::text = 'PENDING' THEN 'DRAFT'
        ELSE "status"::text
    END
)::"PurchaseOrderStatus_new";
ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";
DROP TYPE "PurchaseOrderStatus_old";
ALTER TABLE "PurchaseOrder" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AlterTable Variant
ALTER TABLE "Variant"
    ADD COLUMN "costCurrency" TEXT NOT NULL DEFAULT 'HUF',
    ADD COLUMN "lastPurchasePrice" DECIMAL(12,2),
    ADD COLUMN "lastPurchaseAt" TIMESTAMP(3);

-- AlterTable PurchaseOrder
ALTER TABLE "PurchaseOrder"
    ADD COLUMN "orderNumber" TEXT,
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'HUF',
    ADD COLUMN "exchangeRate" DECIMAL(12,4) NOT NULL DEFAULT 1,
    ADD COLUMN "supplierReference" TEXT,
    ADD COLUMN "orderedAt" TIMESTAMP(3),
    ADD COLUMN "confirmedAt" TIMESTAMP(3),
    ADD COLUMN "expectedDeliveryDate" TIMESTAMP(3),
    ADD COLUMN "note" TEXT,
    ADD COLUMN "createdByUserId" TEXT;

UPDATE "PurchaseOrder"
SET "orderNumber" = 'PO-LEGACY-' || "id"
WHERE "orderNumber" IS NULL;

ALTER TABLE "PurchaseOrder"
    ALTER COLUMN "orderNumber" SET NOT NULL;

-- AlterTable StockMovement
ALTER TABLE "StockMovement"
    ADD COLUMN "goodsReceiptId" TEXT,
    ADD COLUMN "unitCostHuf" DECIMAL(12,2),
    ADD COLUMN "unitPriceHuf" DECIMAL(12,2),
    ADD COLUMN "reversedMovementId" TEXT;

-- CreateTable VariantSupplier
CREATE TABLE "VariantSupplier" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSku" TEXT,
    "supplierProductName" TEXT,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HUF',
    "discountPercent" DECIMAL(5,2),
    "orderUnit" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable PurchaseOrderItem
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "confirmedQuantity" INTEGER,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable GoodsReceipt
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT,
    "targetLocationId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'HUF',
    "exchangeRate" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'OPEN',
    "discrepancyNote" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable GoodsReceiptItem
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "variantId" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "unitCostHuf" DECIMAL(12,2) NOT NULL,
    "expectedLocationId" TEXT,
    "isUnexpected" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable VariantMonthlyStat
CREATE TABLE "VariantMonthlyStat" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "purchasedQty" INTEGER NOT NULL DEFAULT 0,
    "purchasedTotalCostHuf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "soldQty" INTEGER NOT NULL DEFAULT 0,
    "soldRevenueHuf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "soldCogsHuf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "adjustmentQty" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMonthlyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_orderNumber_key" ON "PurchaseOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_reversedMovementId_key" ON "StockMovement"("reversedMovementId");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_type_createdAt_idx" ON "StockMovement"("variantId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_goodsReceiptId_idx" ON "StockMovement"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "VariantSupplier_supplierId_idx" ON "VariantSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "VariantSupplier_variantId_idx" ON "VariantSupplier"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSupplier_variantId_supplierId_key" ON "VariantSupplier"("variantId", "supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_variantId_idx" ON "PurchaseOrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_variantId_key" ON "PurchaseOrderItem"("purchaseOrderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_receiptNumber_key" ON "GoodsReceipt"("receiptNumber");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_targetLocationId_status_idx" ON "GoodsReceipt"("targetLocationId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_status_idx" ON "GoodsReceipt"("status");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_variantId_idx" ON "GoodsReceiptItem"("variantId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_purchaseOrderItemId_idx" ON "GoodsReceiptItem"("purchaseOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptItem_goodsReceiptId_variantId_key" ON "GoodsReceiptItem"("goodsReceiptId", "variantId");

-- CreateIndex
CREATE INDEX "VariantMonthlyStat_productId_year_month_idx" ON "VariantMonthlyStat"("productId", "year", "month");

-- CreateIndex
CREATE INDEX "VariantMonthlyStat_year_month_idx" ON "VariantMonthlyStat"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMonthlyStat_variantId_year_month_key" ON "VariantMonthlyStat"("variantId", "year", "month");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reversedMovementId_fkey" FOREIGN KEY ("reversedMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantSupplier" ADD CONSTRAINT "VariantSupplier_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantSupplier" ADD CONSTRAINT "VariantSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_expectedLocationId_fkey" FOREIGN KEY ("expectedLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMonthlyStat" ADD CONSTRAINT "VariantMonthlyStat_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMonthlyStat" ADD CONSTRAINT "VariantMonthlyStat_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
