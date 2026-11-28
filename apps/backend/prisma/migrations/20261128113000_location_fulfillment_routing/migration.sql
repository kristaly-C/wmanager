ALTER TABLE "Location"
  ADD COLUMN "canFulfillWebshop" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fulfillmentPriority" INTEGER NOT NULL DEFAULT 100;

-- Meglévő raktárak alapértelmezetten magasabb (10) prioritást kapjanak a boltoknál (100)
UPDATE "Location"
SET "fulfillmentPriority" = 10
WHERE "type" = 'WAREHOUSE';

ALTER TABLE "SalesOrder"
  ADD COLUMN "isPickup" BOOLEAN NOT NULL DEFAULT false;
