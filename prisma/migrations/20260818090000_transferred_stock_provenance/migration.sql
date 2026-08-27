-- Stock that arrived from another site can now say so.
--
-- Until now the entry created when a consignment was received looked exactly
-- like a fresh purchase from the origin's vendor: source defaulted to
-- PURCHASED and nothing pointed back at the dispatch it came on.

-- 1. A third kind of stock. Postgres 12+ allows this outside a transaction and
--    inside one as long as the new value is not USED in the same transaction —
--    it is not: nothing below writes it.
ALTER TYPE "StockSource" ADD VALUE IF NOT EXISTS 'TRANSFERRED';

-- 2. The line of the dispatch these goods arrived on. Nullable, because every
--    entry that predates this migration has no consignment to point at, and
--    because purchased and built stock never will.
ALTER TABLE "stock_entries" ADD COLUMN "sourceDispatchItemId" TEXT;

CREATE INDEX "stock_entries_sourceDispatchItemId_idx"
  ON "stock_entries"("sourceDispatchItemId");

-- ON DELETE SET NULL: removing a dispatch line must never remove the stock it
-- produced. The entry survives and simply stops naming where it came from.
ALTER TABLE "stock_entries"
  ADD CONSTRAINT "stock_entries_sourceDispatchItemId_fkey"
  FOREIGN KEY ("sourceDispatchItemId") REFERENCES "dispatch_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
