-- The catalog gains a second level, and products gain a description.
--
-- Until now a product was filed under a category and nothing else, so
-- "Electronics" held both a 3W control board and a 3-ohm resistor with no way
-- to say they are different KINDS of electronic part. A subcategory says so:
--
--   Electronics (1004) → PCB       → 3W_CONTROL_BOARD   "BLDC Control board"
--   Electronics (1004) → Resistor  → 3_OHM              "3 ohm 1W resistor"
--
-- Everything added here is NULLABLE and every rule ships OFF. An existing
-- catalog keeps working on the day this lands, and an admin tightens the rules
-- once the data is ready — see catalog_config at the bottom.

-- 1. The subcategories themselves.
--
--    `code` is optional and, when set, becomes the middle segment of a product
--    code: 1004 + PCB + 3W_CONTROL_BOARD → 1004-PCB-3W_CONTROL_BOARD. Left null,
--    the code keeps its original two-part shape, which is why no existing
--    product code has to be reissued.
--
--    Both uniques are scoped to the category, not global: "Bracket" under
--    Mechanical and "Bracket" under Fabrication are different things.
CREATE TABLE "product_subcategories" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code"       TEXT,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_subcategories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_subcategories_categoryId_name_key"
  ON "product_subcategories"("categoryId", "name");
CREATE UNIQUE INDEX "product_subcategories_categoryId_code_key"
  ON "product_subcategories"("categoryId", "code");
CREATE INDEX "product_subcategories_categoryId_idx"
  ON "product_subcategories"("categoryId");

-- Deleting a category takes its subcategories with it. They cannot outlive it:
-- a subcategory with no parent has no meaning and could not hand out a code.
ALTER TABLE "product_subcategories"
  ADD CONSTRAINT "product_subcategories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Products: which subcategory, and what the thing actually is in words.
--    Null on every existing row, which is the "not filed yet" state.
ALTER TABLE "products" ADD COLUMN "subcategoryId" TEXT;
ALTER TABLE "products" ADD COLUMN "description"   TEXT;

CREATE INDEX "products_subcategoryId_idx" ON "products"("subcategoryId");

-- RESTRICT, not CASCADE: deleting a subcategory that products are filed under
-- must fail loudly rather than quietly deleting the products themselves.
ALTER TABLE "products"
  ADD CONSTRAINT "products_subcategoryId_fkey"
  FOREIGN KEY ("subcategoryId") REFERENCES "product_subcategories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. A catalog request can carry the asker's suggestion for both. The reviewer
--    may change either when approving — they are the one who has to satisfy
--    whatever the rules below require.
ALTER TABLE "product_requests" ADD COLUMN "subcategoryId" TEXT;
ALTER TABLE "product_requests" ADD COLUMN "description"   TEXT;

ALTER TABLE "product_requests"
  ADD CONSTRAINT "product_requests_subcategoryId_fkey"
  FOREIGN KEY ("subcategoryId") REFERENCES "product_subcategories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. How strict the catalog is, as one row beside the other flow configs.
--
--    All three default to FALSE deliberately. Shipping them on would reject
--    every product form against a catalog where no subcategory exists yet.
CREATE TABLE "catalog_config" (
  "id"                     TEXT NOT NULL DEFAULT 'singleton',
  "requireSubcategory"     BOOLEAN NOT NULL DEFAULT false,
  "requireSubcategoryCode" BOOLEAN NOT NULL DEFAULT false,
  "requireDescription"     BOOLEAN NOT NULL DEFAULT false,
  "updatedById"            TEXT,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "catalog_config" ("id", "updatedAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
