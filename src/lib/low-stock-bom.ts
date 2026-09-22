import { prisma } from "@/lib/prisma";

/**
 * Low-stock watches that follow the bills of materials.
 *
 * Every component of every published, in-force BOM is watched automatically —
 * no one has to remember to add the 200 parts of a new product by hand.
 *
 *   WHERE   at each site that has built the product, or already holds the
 *           component in approved stock. A site that never builds it gets no
 *           alerts for it.
 *   HOW MUCH  minimum = quantity per unit × N, where N is the BOM's own
 *           "keep enough for N builds" (lowStockBuilds). A component used by
 *           several products takes the largest of those.
 *
 * The rest of the alert is unchanged: src/lib/low-stock.ts adds daily use ×
 * lead time on top of this minimum, exactly as for a watch added by hand.
 *
 * What a person decides always wins:
 *
 *   - Setting the minimum by hand turns the row into a manual watch (fromBom
 *     false). It is never changed or removed automatically after that.
 *   - Stopping a watch marks it `stopped` rather than deleting it, so this sync
 *     does not add it straight back. Watching it again by hand clears that.
 *   - A watch added by hand is never touched here, even for a BOM component.
 *
 * When a component leaves every BOM, the automatic watches for it go too.
 *
 * Called by: publishing, approving, switching or deleting a BOM and changing
 * its N (bom.ts), starting a build (builds.ts), approving a stock entry
 * (stock.ts, after the response), and "Update from BOMs" on the low-stock card.
 * Cheap to run in full — four reads and one batch of writes — so it always
 * recomputes everything rather than patching.
 */
export async function syncBomWatches(): Promise<{ added: number; updated: number; removed: number }> {
  const boms = await prisma.billOfMaterials.findMany({
    where: { status: "PUBLISHED", isActive: true, product: { isActive: true } },
    select: {
      productId: true,
      lowStockBuilds: true,
      lines: { select: { componentProductId: true, quantityPerUnit: true } },
    },
  });

  // The minimum each component needs, and which products use it
  const minimumFor = new Map<string, number>();
  const componentsOf = new Map<string, string[]>();
  for (const bom of boms) {
    const builds = Math.max(1, bom.lowStockBuilds);
    componentsOf.set(bom.productId, bom.lines.map((l) => l.componentProductId));
    for (const line of bom.lines) {
      const needed = line.quantityPerUnit * builds;
      minimumFor.set(line.componentProductId, Math.max(minimumFor.get(line.componentProductId) ?? 0, needed));
    }
  }
  const componentIds = [...minimumFor.keys()];

  const [built, held, levels] = await Promise.all([
    // Sites that have built each product (a reversed build made nothing)
    prisma.build.findMany({
      where: { productId: { in: [...componentsOf.keys()] }, status: { not: "REVERSED" }, location: { isActive: true } },
      select: { productId: true, locationId: true },
      distinct: ["productId", "locationId"],
    }),
    // Sites already holding a component
    prisma.stockEntry.findMany({
      where: {
        productId: { in: componentIds },
        status: "APPROVED",
        locationId: { not: null },
        location: { isActive: true },
      },
      select: { productId: true, locationId: true },
      distinct: ["productId", "locationId"],
    }),
    prisma.stockLevel.findMany({
      select: { id: true, productId: true, locationId: true, minimum: true, fromBom: true, stopped: true },
    }),
  ]);

  // Every (component, site) that should be watched, with its minimum
  const wanted = new Map<string, { productId: string; locationId: string; minimum: number }>();
  const want = (productId: string, locationId: string) =>
    wanted.set(`${productId}|${locationId}`, { productId, locationId, minimum: minimumFor.get(productId)! });
  for (const b of built) for (const c of componentsOf.get(b.productId) ?? []) want(c, b.locationId);
  for (const h of held) if (h.productId && h.locationId) want(h.productId, h.locationId);

  const existing = new Map(levels.map((l) => [`${l.productId}|${l.locationId}`, l]));
  const creates = [...wanted.entries()].filter(([key]) => !existing.has(key)).map(([, w]) => w);
  const updates = levels.filter((l) => {
    const w = wanted.get(`${l.productId}|${l.locationId}`);
    return l.fromBom && !l.stopped && w && Math.abs(w.minimum - l.minimum) > 1e-9;
  });
  // Automatic, still active, and no longer in any BOM (or no longer at a site that uses it)
  const removals = levels.filter((l) => l.fromBom && !l.stopped && !wanted.has(`${l.productId}|${l.locationId}`));

  if (creates.length || updates.length || removals.length) {
    await prisma.$transaction([
      prisma.stockLevel.createMany({
        data: creates.map((w) => ({ ...w, fromBom: true })),
        skipDuplicates: true,
      }),
      ...updates.map((l) =>
        prisma.stockLevel.update({
          where: { id: l.id },
          data: { minimum: wanted.get(`${l.productId}|${l.locationId}`)!.minimum },
        })
      ),
      prisma.stockLevel.deleteMany({ where: { id: { in: removals.map((l) => l.id) } } }),
    ]);
  }

  return { added: creates.length, updated: updates.length, removed: removals.length };
}
