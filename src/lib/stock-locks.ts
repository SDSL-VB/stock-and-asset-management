import { Prisma } from "@prisma/client";

/**
 * Holding stock entries still while one action decides how much of them to use.
 *
 * "Is enough available?" and "take it" must happen as one step, or two people
 * pressing at the same moment both see the same free quantity and both take it.
 * Call this first inside a transaction, then re-read availability with the
 * transaction client: anyone else locking the same entries waits until this
 * transaction ends, and then sees what it took.
 *
 * Locked in id order, so two transactions locking overlapping sets queue
 * rather than deadlock.
 */
export async function lockEntries(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`SELECT id FROM stock_entries WHERE id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`;
}
