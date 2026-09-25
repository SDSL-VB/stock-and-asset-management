-- Notifications that belong together — every low component of one BOM at one site.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "groupKey" TEXT,
ADD COLUMN     "groupLabel" TEXT;

