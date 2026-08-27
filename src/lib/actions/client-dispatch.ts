import { prisma } from "@/lib/prisma";

/**
 * Raises the outgoing dispatch for a stock entry bought to go straight to a
 * customer.
 *
 * Such an entry books into stock from the vendor and must then leave again — it
 * is not "client stock" sitting somewhere. Without this the entry stays in
 * central stock with a client attached and appears nowhere outgoing, which is
 * exactly the bug this fixes.
 *
 * Called when the last approval step completes. Safe to call for any entry: it
 * does nothing unless the entry names a client, has a location, and has no
 * dispatch already.
 */
export async function raiseClientDispatchForEntry(
  stockEntryId: string,
  raisedByUserId: string
): Promise<{ dispatchNumber: string } | null> {
  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    select: {
      id: true,
      quantity: true,
      batchNumber: true,
      clientId: true,
      locationId: true,
      isAsset: true,
      dispatchItems: { select: { id: true } },
    },
  });

  if (!entry) return null;
  if (!entry.clientId || !entry.locationId) return null;
  // Already sent out — never raise a second consignment for the same goods
  if (entry.dispatchItems.length > 0) return null;

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `DSP-${dateStr}-`;
  const last = await prisma.dispatch.findFirst({
    where: { dispatchNumber: { startsWith: prefix } },
    orderBy: { dispatchNumber: "desc" },
    select: { dispatchNumber: true },
  });
  const seq = last ? parseInt(last.dispatchNumber.split("-").pop() || "0", 10) + 1 : 1;
  const dispatchNumber = `${prefix}${seq.toString().padStart(3, "0")}`;

  const dispatch = await prisma.dispatch.create({
    data: {
      dispatchNumber,
      originLocationId: entry.locationId,
      destination: "CLIENT",
      clientId: entry.clientId,
      // A client consignment has nobody to accept it, so it leaves in transit
      status: "IN_TRANSIT",
      notes: "Raised automatically — bought to ship directly to this client",
      createdById: raisedByUserId,
      items: {
        create: [
          {
            stockEntryId: entry.id,
            quantity: entry.quantity,
            isAsset: entry.isAsset,
            // Inherited from the entry; blank until a batch is known
            batchNumber: entry.batchNumber,
          },
        ],
      },
    },
    select: { dispatchNumber: true },
  });

  return dispatch;
}
