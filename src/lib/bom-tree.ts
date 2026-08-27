import type { Prisma } from "@prisma/client";

/**
 * Bills of Materials are recursive: a simulator is made of finished goods, and one of
 * those is made of raw materials. That is the same structure at two levels,
 * which is what keeps this from becoming two parallel systems — but it also
 * allows a cycle, and a bill of materials that contains itself would expand forever.
 *
 * The guard runs when a line is *saved*, because it is cheap to walk the tree
 * once at write time and impossible to recover from at read time.
 */

/** How deep a bill of materials may nest before we call it a mistake. */
export const MAX_BOM_DEPTH = 12;

/**
 * True when adding `componentId` to `parentProductId`'s bill of materials would create a
 * loop — either directly (a contains a) or through any chain beneath it.
 */
export async function wouldCreateCycle(
  tx: Prisma.TransactionClient,
  parentProductId: string,
  componentId: string
): Promise<boolean> {
  if (parentProductId === componentId) return true;

  // Walk down from the component: if the parent appears anywhere below, adding
  // this line would close a loop.
  const seen = new Set<string>([componentId]);
  let frontier = [componentId];
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_BOM_DEPTH) {
    const boms = await tx.billOfMaterials.findMany({
      where: { productId: { in: frontier }, isActive: true },
      select: { lines: { select: { componentProductId: true } } },
    });

    const next: string[] = [];
    for (const bom of boms) {
      for (const line of bom.lines) {
        if (line.componentProductId === parentProductId) return true;
        if (!seen.has(line.componentProductId)) {
          seen.add(line.componentProductId);
          next.push(line.componentProductId);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  return false;
}

export type ExpandedLine = {
  productId: string;
  code: string;
  name: string;
  unit: string;
  kind: string;
  categoryName: string;
  /** Quantity for the whole expansion, not per parent unit */
  quantity: number;
  isOptional: boolean;
  depth: number;
  /** Product ids from the root down to this line's parent */
  path: string[];
  hasOwnBom: boolean;
  notes: string | null;
};

/**
 * Flattens a bill of materials into every component it needs, multiplying quantities down
 * the tree. A row that is optional anywhere above it is optional here too —
 * you cannot need a part of something you did not order.
 */
export async function expandBom(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity = 1
): Promise<ExpandedLine[]> {
  const out: ExpandedLine[] = [];

  async function walk(
    parentId: string,
    multiplier: number,
    depth: number,
    path: string[],
    inheritedOptional: boolean
  ) {
    if (depth >= MAX_BOM_DEPTH) return;

    const bom = await tx.billOfMaterials.findFirst({
      where: { productId: parentId, isActive: true },
      include: {
        lines: {
          include: {
            component: {
              include: { category: { select: { name: true } } },
            },
          },
          orderBy: { displayOrder: "asc" },
        },
      },
    });
    if (!bom) return;

    for (const line of bom.lines) {
      const qty = line.quantityPerUnit * multiplier;
      const optional = inheritedOptional || line.isOptional;

      const childBom = await tx.billOfMaterials.findFirst({
        where: { productId: line.componentProductId, isActive: true },
        select: { id: true },
      });

      out.push({
        productId: line.component.id,
        code: line.component.code,
        name: line.component.name,
        unit: line.component.unit,
        kind: line.component.kind,
        categoryName: line.component.category.name,
        quantity: qty,
        isOptional: optional,
        depth,
        path,
        hasOwnBom: !!childBom,
        notes: line.notes,
      });

      if (childBom) {
        await walk(line.componentProductId, qty, depth + 1, [...path, parentId], optional);
      }
    }
  }

  await walk(productId, quantity, 0, [], false);
  return out;
}
