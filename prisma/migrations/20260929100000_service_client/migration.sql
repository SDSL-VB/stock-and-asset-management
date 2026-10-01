-- The client a service item came from. Nullable: only service entries have one.

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "serviceClientId" TEXT;

-- CreateIndex
CREATE INDEX "stock_entries_serviceClientId_idx" ON "stock_entries"("serviceClientId");

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_serviceClientId_fkey" FOREIGN KEY ("serviceClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
