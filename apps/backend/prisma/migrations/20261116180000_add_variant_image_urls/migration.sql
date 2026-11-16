-- AlterTable
ALTER TABLE "Variant" ADD COLUMN "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
