-- AlterTable
ALTER TABLE "StocktakeSession" ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "StocktakeItem" (
    "id" TEXT NOT NULL,
    "stocktakeSessionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "countedQuantity" INTEGER,
    "ddiscrepancy" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StocktakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StocktakeItem_stocktakeSessionId_idx" ON "StocktakeItem"("stocktakeSessionId");

-- CreateIndex
CREATE INDEX "StocktakeItem_variantId_idx" ON "StocktakeItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StocktakeItem_stocktakeSessionId_variantId_key" ON "StocktakeItem"("stocktakeSessionId", "variantId");

-- AddForeignKey
ALTER TABLE "StocktakeSession" ADD CONSTRAINT "StocktakeSession_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeItem" ADD CONSTRAINT "StocktakeItem_stocktakeSessionId_fkey" FOREIGN KEY ("stocktakeSessionId") REFERENCES "StocktakeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StocktakeItem" ADD CONSTRAINT "StocktakeItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
