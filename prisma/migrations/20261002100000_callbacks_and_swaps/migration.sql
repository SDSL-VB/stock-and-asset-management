-- Call-backs (recalling a batch) and parts swapped at a customer's premises.
-- Additive: a new stock source, nullable links, two tables.

-- CreateEnum
CREATE TYPE "CallBackStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "StockSource" ADD VALUE 'CALLBACK';

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "callBackId" TEXT;

-- AlterTable
ALTER TABLE "stock_issues" ADD COLUMN     "callBackId" TEXT;

-- AlterTable
ALTER TABLE "stock_transfer_requests" ADD COLUMN     "callBackId" TEXT;

-- CreateTable
CREATE TABLE "call_backs" (
    "id" TEXT NOT NULL,
    "callBackNumber" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "productId" TEXT,
    "reason" TEXT NOT NULL,
    "notifyAllSites" BOOLEAN NOT NULL DEFAULT false,
    "status" "CallBackStatus" NOT NULL DEFAULT 'OPEN',
    "locationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "call_backs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_swaps" (
    "id" TEXT NOT NULL,
    "callBackId" TEXT,
    "clientId" TEXT NOT NULL,
    "customerBatch" TEXT NOT NULL,
    "partProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "replacementBatch" TEXT,
    "dispatchId" TEXT,
    "notes" TEXT,
    "swappedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_backs_callBackNumber_key" ON "call_backs"("callBackNumber");

-- CreateIndex
CREATE INDEX "call_backs_batchNumber_idx" ON "call_backs"("batchNumber");

-- CreateIndex
CREATE INDEX "call_backs_status_idx" ON "call_backs"("status");

-- CreateIndex
CREATE INDEX "service_swaps_customerBatch_idx" ON "service_swaps"("customerBatch");

-- CreateIndex
CREATE INDEX "service_swaps_replacementBatch_idx" ON "service_swaps"("replacementBatch");

-- CreateIndex
CREATE INDEX "service_swaps_clientId_idx" ON "service_swaps"("clientId");

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_callBackId_fkey" FOREIGN KEY ("callBackId") REFERENCES "call_backs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_callBackId_fkey" FOREIGN KEY ("callBackId") REFERENCES "call_backs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_callBackId_fkey" FOREIGN KEY ("callBackId") REFERENCES "call_backs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_backs" ADD CONSTRAINT "call_backs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_backs" ADD CONSTRAINT "call_backs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_backs" ADD CONSTRAINT "call_backs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_backs" ADD CONSTRAINT "call_backs_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_swaps" ADD CONSTRAINT "service_swaps_callBackId_fkey" FOREIGN KEY ("callBackId") REFERENCES "call_backs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_swaps" ADD CONSTRAINT "service_swaps_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_swaps" ADD CONSTRAINT "service_swaps_partProductId_fkey" FOREIGN KEY ("partProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_swaps" ADD CONSTRAINT "service_swaps_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_swaps" ADD CONSTRAINT "service_swaps_swappedById_fkey" FOREIGN KEY ("swappedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

