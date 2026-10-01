-- A department asking central stock for materials, approved by its manager
-- and then supplied (moved in) by the Stock Manager.

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('PENDING_DEPARTMENT', 'PENDING_STOCK', 'SUPPLIED', 'PARTLY_SUPPLIED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'PENDING_DEPARTMENT',
    "notes" TEXT,
    "forProductId" TEXT,
    "forQuantity" INTEGER,
    "requestedById" TEXT NOT NULL,
    "departmentApprovedById" TEXT,
    "departmentApprovedAt" TIMESTAMP(3),
    "suppliedById" TEXT,
    "suppliedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "shortfallRaisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "supplied" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "material_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_requestNumber_key" ON "material_requests"("requestNumber");

-- CreateIndex
CREATE INDEX "material_requests_status_idx" ON "material_requests"("status");

-- CreateIndex
CREATE INDEX "material_requests_departmentId_idx" ON "material_requests"("departmentId");

-- CreateIndex
CREATE INDEX "material_requests_locationId_idx" ON "material_requests"("locationId");

-- CreateIndex
CREATE INDEX "material_request_lines_requestId_idx" ON "material_request_lines"("requestId");

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_forProductId_fkey" FOREIGN KEY ("forProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_departmentApprovedById_fkey" FOREIGN KEY ("departmentApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_suppliedById_fkey" FOREIGN KEY ("suppliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "material_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

