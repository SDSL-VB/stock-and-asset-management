-- Correcting three foreign keys on stock_write_offs.
--
-- The wastage migration declared reviewedById, reversedById and departmentId as
-- ON DELETE RESTRICT, but all three are OPTIONAL columns, and Prisma's schema
-- therefore expects ON DELETE SET NULL. `prisma migrate diff` reported the
-- database and the schema disagreeing about all three.
--
-- It is not only a tidiness problem. Deleting a person re-points their records
-- at the hidden system account, and a RESTRICT here meant deleting somebody who
-- had ever REVIEWED or REVERSED a write-off failed with a raw foreign-key error
-- instead — a person the app said could be deleted, and could not be. Same for
-- deleting a department that had written anything off.
--
-- SET NULL is the right behaviour for all three: the write-off record survives,
-- and loses only its pointer to a reviewer who no longer exists. What actually
-- happened is still readable, because the activity log snapshots the actor's
-- name at the time.
--
-- `raisedById` is deliberately NOT changed. It is a required column, so RESTRICT
-- is correct there — a write-off with no raiser would be a record nobody owns.
-- That one is handled by re-pointing it at the system account, in deleteUser().

ALTER TABLE "stock_write_offs"
  DROP CONSTRAINT "stock_write_offs_reviewedById_fkey",
  ADD  CONSTRAINT "stock_write_offs_reviewedById_fkey"
       FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
       ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  DROP CONSTRAINT "stock_write_offs_reversedById_fkey",
  ADD  CONSTRAINT "stock_write_offs_reversedById_fkey"
       FOREIGN KEY ("reversedById") REFERENCES "users"("id")
       ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_write_offs"
  DROP CONSTRAINT "stock_write_offs_departmentId_fkey",
  ADD  CONSTRAINT "stock_write_offs_departmentId_fkey"
       FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
       ON DELETE SET NULL ON UPDATE CASCADE;
