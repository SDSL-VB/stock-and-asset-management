-- Builds draw on their department's own stock: each run records its department,
-- and each component it takes records the department holding it came from.
-- Both nullable: runs from before this took from central stock.

-- AlterTable
ALTER TABLE "build_consumptions" ADD COLUMN     "stockIssueId" TEXT;

-- AlterTable
ALTER TABLE "builds" ADD COLUMN     "departmentId" TEXT;

-- CreateIndex
CREATE INDEX "build_consumptions_stockIssueId_idx" ON "build_consumptions"("stockIssueId");

-- AddForeignKey
ALTER TABLE "builds" ADD CONSTRAINT "builds_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_consumptions" ADD CONSTRAINT "build_consumptions_stockIssueId_fkey" FOREIGN KEY ("stockIssueId") REFERENCES "stock_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

