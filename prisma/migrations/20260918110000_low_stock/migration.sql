-- What the low-stock alert needs: a minimum per product per site, and how long
-- each vendor takes to deliver each product.
--
--   reorder point = daily use × lead time + minimum
--
-- The alert is worked out from these two tables and from stock itself every
-- time it is read (src/lib/low-stock.ts); nothing here stores an alert. Both
-- tables start empty: nothing is watched until someone sets a minimum.
--
-- Generated with `prisma migrate diff` against the schema, then annotated.

-- 1. Who we can buy a product from, and how many days they take. On the pair,
--    because one bearing can take two days from a local stockist and three
--    weeks from the manufacturer.
CREATE TABLE "product_vendors" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_vendors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_vendors_productId_vendorId_key" ON "product_vendors"("productId", "vendorId");
CREATE INDEX "product_vendors_vendorId_idx" ON "product_vendors"("vendorId");

-- 2. The least a site should hold of a product. Setting one is what puts the
--    product under watch at that site. Double precision: a minimum can be
--    50 metres of cable.
CREATE TABLE "stock_levels" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "minimum" DOUBLE PRECISION NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_levels_productId_locationId_key" ON "stock_levels"("productId", "locationId");
CREATE INDEX "stock_levels_locationId_idx" ON "stock_levels"("locationId");

-- Both are settings ABOUT a product, vendor or site, with no meaning once that
-- is gone — so they go with it.
ALTER TABLE "product_vendors" ADD CONSTRAINT "product_vendors_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_vendors" ADD CONSTRAINT "product_vendors_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
