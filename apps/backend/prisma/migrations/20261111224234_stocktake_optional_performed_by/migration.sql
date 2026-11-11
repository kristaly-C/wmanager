-- DropForeignKey
ALTER TABLE "StocktakeSession" DROP CONSTRAINT "StocktakeSession_performedByUserId_fkey";

-- AlterTable
ALTER TABLE "StocktakeSession" ALTER COLUMN "performedByUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "StocktakeSession" ADD CONSTRAINT "StocktakeSession_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
