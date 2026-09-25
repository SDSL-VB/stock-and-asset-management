-- How long a category code may be, set in Catalog settings. Additive only.

-- AlterTable
ALTER TABLE "catalog_config" ADD COLUMN     "categoryCodeLength" INTEGER NOT NULL DEFAULT 4;

