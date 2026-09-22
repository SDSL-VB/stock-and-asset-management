-- Rack positions for stock in the store ("10.3" = rack 10, row 3). Additive
-- only: one nullable column and an index.

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "rackLocation" TEXT;

-- CreateIndex
CREATE INDEX "stock_entries_rackLocation_idx" ON "stock_entries"("rackLocation");

