/*
  Warnings:

  - You are about to drop the column `ddiscrepancy` on the `StocktakeItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StocktakeItem" DROP COLUMN "ddiscrepancy",
ADD COLUMN     "discrepancy" INTEGER;
