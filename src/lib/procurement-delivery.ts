/**
 * What counts as delivered against a purchase order line.
 *
 * Kept out of the actions file because a `"use server"` module may only export
 * async functions — and kept in one place for the same reason availability is:
 * the order page, the stock entry form and the auto-close all have to agree on
 * what "arrived" means, or an order closes at the wrong moment.
 *
 * A draft entry is someone part-way through typing and may never be finished,
 * so it does not yet mean the goods came. A rejected entry means they were
 * refused. Everything between is a real arrival.
 */
export const DELIVERED_ENTRY_STATUSES = ["SUBMITTED", "APPROVED"] as const;

/** Prisma `where` fragment selecting the entries that count as delivered. */
export const deliveredEntriesWhere = {
  status: { in: [...DELIVERED_ENTRY_STATUSES] },
};

