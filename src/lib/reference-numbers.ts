import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * The human-readable numbers on every record: SE-20260817-001 and friends.
 *
 * Used by: stock entries, stock issues, transfer requests, dispatches, site
 * requests, purchase intents and purchase orders — nine places that each had
 * their own copy of the same fifteen lines, one of which generated the SAME
 * prefix as another in a different file.
 *
 * The shape is always `<prefix>-<yyyymmdd>-<nnn>`, and the sequence restarts
 * each day, so the number tells you when something happened without opening it.
 */

/** Which record a number belongs to, and the table its sequence is counted in. */
const SERIES = {
  /** Stock entry — goods arriving */
  SE: { model: "stockEntry", field: "entryNumber" },
  /** Stock issue — stock moving into a department */
  SI: { model: "stockIssue", field: "issueNumber" },
  /** Transfer request — asking for that move */
  TR: { model: "stockTransferRequest", field: "requestNumber" },
  /** Dispatch — a consignment leaving a site */
  DSP: { model: "dispatch", field: "dispatchNumber" },
  /** Site request — one site asking another for stock */
  SRQ: { model: "siteRequest", field: "requestNumber" },
  /** Purchase intent — "we need this" */
  PI: { model: "purchaseIntent", field: "intentNumber" },
  /** Purchase order — what was ordered from a vendor */
  PO: { model: "purchaseOrder", field: "poNumber" },
} as const;

export type ReferenceSeries = keyof typeof SERIES;

/**
 * The next number in a series, for today.
 *
 * Reads the highest number already issued today and adds one. Two people
 * saving at the same instant could in principle land on the same number; the
 * unique constraint on each column is what actually prevents a duplicate, and
 * this is only here to pick the obvious next one.
 *
 * Pass the transaction client when you are inside `$transaction` AND creating
 * more than one record of the same series: rows written earlier in that
 * transaction are invisible to the outside client, so every one of them would
 * be handed the same number and the second insert would fail. Receiving a
 * consignment of three items is exactly that case.
 */
export async function nextReference(
  series: ReferenceSeries,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const { model, field } = SERIES[series];
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${series}-${today}-`;

  // Prisma's delegates all share this shape, so one lookup serves every series
  const delegate = client[model] as unknown as {
    findFirst(args: unknown): Promise<Record<string, string> | null>;
  };

  const last = await delegate.findFirst({
    where: { [field]: { startsWith: prefix } },
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });

  const previous = last ? parseInt(last[field].split("-").pop() || "0", 10) : 0;
  return `${prefix}${(previous + 1).toString().padStart(3, "0")}`;
}
