-- AlterTable
ALTER TABLE "stock_transfer_requests" ADD COLUMN     "departmentApprovedAt" TIMESTAMP(3),
ADD COLUMN     "departmentApprovedById" TEXT;

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_departmentApprovedById_fkey" FOREIGN KEY ("departmentApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Requests already in flight were raised before the department step existed:
-- count them as agreed, so none is held back behind a step nobody asked for
UPDATE "stock_transfer_requests"
SET "departmentApprovedAt" = "createdAt", "departmentApprovedById" = "requestedById"
WHERE "departmentApprovedAt" IS NULL;
