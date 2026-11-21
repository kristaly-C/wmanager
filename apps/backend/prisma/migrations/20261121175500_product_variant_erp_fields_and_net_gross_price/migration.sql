-- AlterTable Product: make apparel-specific fields optional and add base ERP/NAV fields
ALTER TABLE "Product"
  ALTER COLUMN "gender" DROP NOT NULL,
  ALTER COLUMN "model" DROP NOT NULL,
  ALTER COLUMN "manufacturerCode" DROP NOT NULL,
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'DB',
  ADD COLUMN "vtszCode" TEXT,
  ADD COLUMN "originCountry" TEXT,
  ADD COLUMN "importantNote" TEXT,
  ADD COLUMN "season" TEXT,
  ADD COLUMN "isSerialized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isPurchasable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Variant: make size/weight optional, default colors to empty array, add netWeight/volume, rename price -> grossPrice and backfill netPrice
ALTER TABLE "Variant" RENAME COLUMN "price" TO "grossPrice";

ALTER TABLE "Variant"
  ALTER COLUMN "colors" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "size" DROP NOT NULL,
  ALTER COLUMN "weight" DROP NOT NULL,
  ADD COLUMN "netWeight" DECIMAL(10,3),
  ADD COLUMN "volume" DECIMAL(10,6),
  ADD COLUMN "netPrice" DECIMAL(12,2);

UPDATE "Variant" v
SET "netPrice" = ROUND(v."grossPrice" / (1 + (p."vatRate" / 100.0)), 2)
FROM "Product" p
WHERE p."id" = v."productId";

ALTER TABLE "Variant" ALTER COLUMN "netPrice" SET NOT NULL;
