-- Low-stock watches kept from BOMs: how many builds' worth each BOM keeps in
-- stock, and on each watch whether it came from a BOM and whether it was
-- stopped. Additive only.

-- AlterTable
ALTER TABLE "bills_of_materials" ADD COLUMN     "lowStockBuilds" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "stock_levels" ADD COLUMN     "fromBom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stopped" BOOLEAN NOT NULL DEFAULT false;

