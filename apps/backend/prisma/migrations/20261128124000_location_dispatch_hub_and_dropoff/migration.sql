ALTER TABLE "Location"
  ADD COLUMN "dispatchHubLocationId" TEXT,
  ADD COLUMN "isDropoffLocation" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Location_dispatchHubLocationId_idx" ON "Location"("dispatchHubLocationId");

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_dispatchHubLocationId_fkey"
  FOREIGN KEY ("dispatchHubLocationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
