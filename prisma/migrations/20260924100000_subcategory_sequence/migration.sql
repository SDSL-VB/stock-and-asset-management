-- Product numbers run 001, 002, ... within each subcategory.

-- AlterTable
ALTER TABLE "product_subcategories" ADD COLUMN     "nextSequence" INTEGER NOT NULL DEFAULT 1;

