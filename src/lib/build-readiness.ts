import { prisma } from "@/lib/prisma";
import { availabilityInclude, availableQuantity, round } from "@/lib/stock-availability";

/**
 * "How many can we build?" — the one place that answers it.
 *
 * Called by: builds.ts (readiness for one run at one site), fulfilment.ts (what
 * every site could build towards an order), and the low-stock alert (what is
 * free at each site).
 *
 * This used to be written twice, in builds.ts and fulfilment.ts. The two agreed,
 * but only by coincidence — nothing kept them in step — and the fulfilment copy
 * ran a query per component per site. Both now read the rule below and the
 * stock figure beneath it.
 *
 * The rule itself is short:
 *
 *   each component line supports floor(free stock ÷ quantity per unit) units
 *   the build supports the SMALLEST of those, over the lines that are required
 *   an optional line never blocks a build — nobody ordered that add-on
 *
 * "Free stock" is central stock at the site, approved, less everything already
 * promised — `availableQuantity()`, never the raw entry quantity.
 */

/** One component line, reduced to what the rule needs. */
export type ReadinessLine = {
  perUnit: number;
  available: number;
  isOptional: boolean;
};

/** How many whole units one line could supply on its own. */
export function unitsFromLine(line: { perUnit: number; available: number }): number {
  return line.perUnit > 0 ? Math.floor(line.available / line.perUnit) : 0;
}

/**
 * How many whole units a set of lines supports together: the scarcest required
 * line decides. A bill of materials with no required lines supports none — an
 * empty recipe is not a licence to build infinitely many.
 */
export function unitsSupported(lines: ReadinessLine[]): number {
  const required = lines.filter((l) => !l.isOptional);
  if (required.length === 0) return 0;
  return Math.max(0, Math.min(...required.map(unitsFromLine)));
}

/**
 * Free central stock of several products at every site, in ONE query.
 *
 * Returns productId → (locationId → free quantity). A product or site with
 * nothing free is simply absent, so read it with `?? 0`.
 */
export async function centralAvailability(
  productIds: string[]
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (productIds.length === 0) return out;

  const entries = await prisma.stockEntry.findMany({
    where: {
      productId: { in: productIds },
      status: "APPROVED",
      // Central stock only: an entry booked straight to a department is that
      // department's, not something a build or another site can draw on.
      departmentId: null,
      locationId: { not: null },
    },
    select: { productId: true, locationId: true, quantity: true, ...availabilityInclude },
  });

  for (const e of entries) {
    const free = availableQuantity(e);
    if (free <= 0 || !e.productId || !e.locationId) continue;
    const bySite = out.get(e.productId) ?? new Map<string, number>();
    bySite.set(e.locationId, round((bySite.get(e.locationId) ?? 0) + free));
    out.set(e.productId, bySite);
  }
  return out;
}

/**
 * How many units of a product the published bill of materials supports at each
 * of the given sites. Two queries in total, however many components or sites.
 */
export async function buildableAtSites(
  productId: string,
  locationIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  const bom = await prisma.billOfMaterials.findFirst({
    where: { productId, isActive: true, status: "PUBLISHED" },
    select: { lines: { select: { componentProductId: true, quantityPerUnit: true, isOptional: true } } },
  });
  if (!bom || bom.lines.length === 0) return result;

  const stock = await centralAvailability(bom.lines.map((l) => l.componentProductId));

  for (const locationId of locationIds) {
    result.set(
      locationId,
      unitsSupported(
        bom.lines.map((l) => ({
          perUnit: l.quantityPerUnit,
          available: stock.get(l.componentProductId)?.get(locationId) ?? 0,
          isOptional: l.isOptional,
        }))
      )
    );
  }
  return result;
}
