/*
  Warnings:

  - You are about to alter the column `vatRate` on the `Product` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(5,2)`.
  - You are about to alter the column `weight` on the `Variant` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(10,3)`.
  - You are about to alter the column `price` on the `Variant` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(12,2)`.
  - You are about to alter the column `costPrice` on the `Variant` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(12,2)`.

*/
-- DropForeignKey
ALTER TABLE "ReturnCaseItem" DROP CONSTRAINT "ReturnCaseItem_returnCaseId_fkey";

-- DropForeignKey
ALTER TABLE "VariantBarcode" DROP CONSTRAINT "VariantBarcode_variantId_fkey";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "vatRate" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Variant" ALTER COLUMN "weight" SET DATA TYPE DECIMAL(10,3),
ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "costPrice" SET DATA TYPE DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE INDEX "Product_primarySupplierId_idx" ON "Product"("primarySupplierId");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_manufacturerCode_idx" ON "Product"("manufacturerCode");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "ReturnCase_handledByUserId_idx" ON "ReturnCase"("handledByUserId");

-- CreateIndex
CREATE INDEX "ReturnCaseItem_returnCaseId_idx" ON "ReturnCaseItem"("returnCaseId");

-- CreateIndex
CREATE INDEX "ReturnCaseItem_variantId_idx" ON "ReturnCaseItem"("variantId");

-- CreateIndex
CREATE INDEX "StockItem_locationId_idx" ON "StockItem"("locationId");

-- CreateIndex
CREATE INDEX "StockMovement_locationId_createdAt_idx" ON "StockMovement"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_createdByUserId_idx" ON "StockMovement"("createdByUserId");

-- CreateIndex
CREATE INDEX "StockTransfer_fromLocationId_idx" ON "StockTransfer"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockTransfer_toLocationId_idx" ON "StockTransfer"("toLocationId");

-- CreateIndex
CREATE INDEX "StocktakeSession_locationId_idx" ON "StocktakeSession"("locationId");

-- CreateIndex
CREATE INDEX "StocktakeSession_performedByUserId_idx" ON "StocktakeSession"("performedByUserId");

-- CreateIndex
CREATE INDEX "UserLocation_locationId_idx" ON "UserLocation"("locationId");

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- CreateIndex
CREATE INDEX "VariantBarcode_variantId_idx" ON "VariantBarcode"("variantId");

-- AddForeignKey
ALTER TABLE "ReturnCaseItem" ADD CONSTRAINT "ReturnCaseItem_returnCaseId_fkey" FOREIGN KEY ("returnCaseId") REFERENCES "ReturnCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantBarcode" ADD CONSTRAINT "VariantBarcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
