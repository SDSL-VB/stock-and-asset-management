import { prisma } from "@/lib/prisma";
import {
  availabilityInclude,
  availableQuantity,
  COMMITTING_DISPATCH_STATUSES,
} from "@/lib/stock-availability";

/**
 * Following a batch wherever it went — what a call-back needs.
 *
 * Starting from one batch number it finds:
 *   central   units of it still free in central stock, per site
 *   customers every client a consignment carried it to, and every client a
 *             part of it was swapped in for on site (ServiceSwap)
 * and then follows it THROUGH BUILDS: a feeder batch built into simulators
 * leads to those simulators' batches, and on to the customers who got them.
 * Three levels deep is far more than any product here nests.
 *
 * Plain reading, no permission of its own — callers decide who may ask.
 */

export type TracedCustomer = {
  clientId: string;
  clientName: string;
  city: string;
  address: string | null;
  gstNumber: string | null;
  /** The batch that reached them — the one called back, or one built from it */
  batchNumber: string;
  itemName: string;
  quantity: number;
  /** How it reached them: a consignment's number, or "swapped on site" */
  via: string;
  /** The site that sent it — whose Service team follows up */
  originLocationId: string | null;
};

export type TracedHolding = {
  entryId: string;
  entryNumber: string;
  itemName: string;
  batchNumber: string;
  locationId: string | null;
  locationName: string | null;
  available: number;
};

const MAX_DEPTH = 3;

export async function traceBatch(batchNumber: string): Promise<{
  batches: string[];
  central: TracedHolding[];
  customers: TracedCustomer[];
}> {
  const seen = new Set<string>();
  const central: TracedHolding[] = [];
  const customers: TracedCustomer[] = [];
  let frontier = [batchNumber.trim()].filter(Boolean);

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const batch of frontier) {
      const key = batch.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const sameBatch = { equals: batch, mode: "insensitive" as const };

      // Still on the shelf, in central stock
      const entries = await prisma.stockEntry.findMany({
        // Central stock only: service stock is a customer's, never called back here
        where: { batchNumber: sameBatch, status: "APPROVED", departmentId: null, forService: false },
        include: { ...availabilityInclude, location: { select: { name: true } } },
      });
      for (const e of entries) {
        const available = availableQuantity(e);
        if (available > 0) {
          central.push({
            entryId: e.id,
            entryNumber: e.entryNumber,
            itemName: e.itemName,
            batchNumber: batch,
            locationId: e.locationId,
            locationName: e.location?.name ?? null,
            available,
          });
        }
      }

      // Shipped to a customer
      const shipped = await prisma.dispatchItem.findMany({
        where: {
          batchNumber: sameBatch,
          dispatch: { destination: "CLIENT", status: { in: [...COMMITTING_DISPATCH_STATUSES] } },
        },
        include: {
          stockEntry: { select: { itemName: true } },
          dispatch: {
            select: {
              dispatchNumber: true,
              originLocationId: true,
              client: { select: { id: true, name: true, city: true, address: true, gstNumber: true } },
            },
          },
        },
      });
      for (const item of shipped) {
        const client = item.dispatch.client;
        if (!client) continue;
        customers.push({
          clientId: client.id,
          clientName: client.name,
          city: client.city,
          address: client.address,
          gstNumber: client.gstNumber,
          batchNumber: batch,
          itemName: item.stockEntry.itemName,
          quantity: item.quantity,
          via: item.dispatch.dispatchNumber,
          originLocationId: item.dispatch.originLocationId,
        });
      }

      // Swapped in at a customer's premises
      const swaps = await prisma.serviceSwap.findMany({
        where: { replacementBatch: sameBatch },
        include: {
          client: { select: { id: true, name: true, city: true, address: true, gstNumber: true } },
          partProduct: { select: { name: true } },
          dispatch: { select: { originLocationId: true } },
        },
      });
      for (const swap of swaps) {
        customers.push({
          clientId: swap.client.id,
          clientName: swap.client.name,
          city: swap.client.city,
          address: swap.client.address,
          gstNumber: swap.client.gstNumber,
          batchNumber: batch,
          itemName: swap.partProduct.name,
          quantity: swap.quantity,
          via: "swapped on site",
          originLocationId: swap.dispatch?.originLocationId ?? null,
        });
      }

      // Built into something else: follow what came out
      const consumedIn = await prisma.buildConsumption.findMany({
        where: { stockEntry: { batchNumber: sameBatch }, build: { status: { not: "REVERSED" } } },
        select: { build: { select: { outputs: { select: { batchNumber: true } } } } },
      });
      for (const c of consumedIn) {
        for (const o of c.build.outputs) if (o.batchNumber) next.push(o.batchNumber);
      }
    }
    frontier = next;
  }

  return { batches: [...seen], central, customers };
}
