-- Stock can now be marked unusable: damaged, lost, expired, obsolete.
--
-- Until now there was no way to say a thing had stopped being stock. The only
-- honest options were to leave it counted (so the report claimed goods nobody
-- could find) or to delete the entry (so the purchase vanished from history
-- too). A write-off records the loss instead of hiding it.
--
-- A manager signs each one off, so the table carries a review the same shape as
-- every other review in the app: raised, then approved or rejected, and
-- reversible afterwards if the approval itself was the mistake.

-- 1. Why stock stopped being stock. The free-text note still carries the
--    detail; this is what the wastage report groups and totals by.
CREATE TYPE "WriteOffReason" AS ENUM (
  'DAMAGED', 'LOST', 'EXPIRED', 'DEFECTIVE', 'OBSOLETE', 'OTHER'
);

-- 2. Where a write-off is in its life. Mirrors StockEntryStatus deliberately,
--    plus REVERSED, which StockEntry has no need of.
CREATE TYPE "WriteOffStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'REVERSED'
);

-- 3. The record itself.
--
--    `quantity` is DOUBLE PRECISION rather than an integer because 3.5 metres
--    of damaged cable is a real write-off. build_consumptions already stores
--    quantities this way for exactly the same reason.
--
--    `stockIssueId` decides the arithmetic and is the one field to get right:
--    null means the goods were in central stock and the loss comes off the
--    entry; set means they were already in a department and the loss comes off
--    that department's holding ONLY — never off the entry as well, which the
--    issue has already been subtracted from.
CREATE TABLE "stock_write_offs" (
  "id"              TEXT NOT NULL,
  "writeOffNumber"  TEXT NOT NULL,
  "stockEntryId"    TEXT NOT NULL,
  "stockIssueId"    TEXT,
  "departmentId"    TEXT,
  "quantity"        DOUBLE PRECISION NOT NULL,
  "reason"          "WriteOffReason" NOT NULL,
  "notes"           TEXT NOT NULL,
  "status"          "WriteOffStatus" NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reversalReason"  TEXT,
  "reversedAt"      TIMESTAMP(3),
  "reversedById"    TEXT,
  "raisedById"      TEXT NOT NULL,
  "reviewedById"    TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "stock_write_offs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_write_offs_writeOffNumber_key"
  ON "stock_write_offs"("writeOffNumber");

-- Every screen that shows a quantity now subtracts write-offs, so the lookup
-- by entry is on the hot path for the stock list, dispatch, transfers and
-- reports alike.
CREATE INDEX "stock_write_offs_stockEntryId_idx" ON "stock_write_offs"("stockEntryId");
CREATE INDEX "stock_write_offs_stockIssueId_idx" ON "stock_write_offs"("stockIssueId");
CREATE INDEX "stock_write_offs_departmentId_idx" ON "stock_write_offs"("departmentId");
CREATE INDEX "stock_write_offs_status_idx"       ON "stock_write_offs"("status");
CREATE INDEX "stock_write_offs_raisedById_idx"   ON "stock_write_offs"("raisedById");

-- ON DELETE CASCADE on the entry and the issue: a write-off describes a
-- quantity of something. If that something is gone, the description of part of
-- it is meaningless and must not be left behind pointing at nothing.
ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_stockEntryId_fkey"
  FOREIGN KEY ("stockEntryId") REFERENCES "stock_entries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_stockIssueId_fkey"
  FOREIGN KEY ("stockIssueId") REFERENCES "stock_issues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT on the department and the people: a loss of ₹40,000 must not become
-- deletable by removing the department it happened in, or the person who
-- signed it off.
ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_raisedById_fkey"
  FOREIGN KEY ("raisedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  ADD CONSTRAINT "stock_write_offs_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. The permissions the feature is gated on.
--
--    These live in prisma/lib/permission-catalog.ts, which seed.ts inserts into
--    a FRESH database. A database that already exists never runs that seed, so
--    without this block the keys would not be rows, and
--    prisma/setup-roles-and-people.ts would refuse to hand out a permission
--    that does not exist. ON CONFLICT keeps it safe to run either way.
INSERT INTO "permissions" ("id", "key", "name", "module", "description", "createdAt")
VALUES
  ('perm_writeoff_view',       'stock.writeoff.view',       'View Write-Offs',       'stock', 'Can see stock that has been written off and the wastage report', CURRENT_TIMESTAMP),
  ('perm_writeoff_create',     'stock.writeoff.create',     'Write Off Stock',       'stock', 'Can mark central stock as damaged, lost or otherwise unusable. A manager still has to approve it', CURRENT_TIMESTAMP),
  ('perm_writeoff_department', 'stock.writeoff.department', 'Write Off Department Stock', 'stock', 'Can mark stock or assets already held by a department as unusable. A manager still has to approve it', CURRENT_TIMESTAMP),
  ('perm_writeoff_approve',    'stock.writeoff.approve',    'Approve Write-Offs',    'stock', 'Can approve or decline a write-off. Approving is what actually removes the stock', CURRENT_TIMESTAMP),
  ('perm_writeoff_reverse',    'stock.writeoff.reverse',    'Reverse Write-Offs',    'stock', 'Can undo an approved write-off and put the stock back, with a reason', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
