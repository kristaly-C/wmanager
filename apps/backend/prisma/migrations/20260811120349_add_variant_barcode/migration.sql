-- CreateTable
CREATE TABLE "VariantBarcode" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VariantBarcode_barcode_key" ON "VariantBarcode"("barcode");

-- AddForeignKey
ALTER TABLE "VariantBarcode" ADD CONSTRAINT "VariantBarcode_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
