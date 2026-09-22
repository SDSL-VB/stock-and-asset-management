-- Needs can now be raised as a LIST, with the reason they belong together.
--
-- A build short of five components used to mean five needs typed by hand, and
-- the buyer then saw five unrelated lines. A need request keeps them as one thing:
-- one number, one reason ("short for 5 × BLDC_Controller at Bengaluru"), and one
-- document to download. The needs themselves stay ordinary purchase_intents, so
-- verifying and ordering them is unchanged.
--
-- Generated with `prisma migrate diff` against the schema, then annotated.

-- 1. Why a list was raised.
CREATE TYPE "NeedSource" AS ENUM ('BUILD_SHORTAGE', 'LOW_STOCK');

-- 2. Which list a need belongs to. Null for a need somebody typed in on its own,
--    which is every need raised before today.
ALTER TABLE "purchase_intents" ADD COLUMN "needListId" TEXT;

-- 3. The list itself.
CREATE TABLE "need_lists" (
    "id" TEXT NOT NULL,
    "listNumber" TEXT NOT NULL,
    "source" "NeedSource" NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER,
    "locationId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "need_lists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "need_lists_listNumber_key" ON "need_lists"("listNumber");
CREATE INDEX "need_lists_createdAt_idx" ON "need_lists"("createdAt");
CREATE INDEX "purchase_intents_needListId_idx" ON "purchase_intents"("needListId");

-- A need outlives its list: deleting the list leaves the needs standing on
-- their own rather than taking them with it.
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_needListId_fkey"
  FOREIGN KEY ("needListId") REFERENCES "need_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "need_lists" ADD CONSTRAINT "need_lists_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "need_lists" ADD CONSTRAINT "need_lists_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Required, so RESTRICT: deleting a person re-points their lists at the system
-- account first (see deleteUser), exactly as it does their other records.
ALTER TABLE "need_lists" ADD CONSTRAINT "need_lists_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
