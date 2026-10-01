-- Stock received for service is held apart from central stock.
-- Every existing entry is ordinary stock, so the default changes nothing.

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "forService" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "stock_entries_forService_idx" ON "stock_entries"("forService");
