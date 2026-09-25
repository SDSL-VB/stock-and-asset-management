"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { availabilityInclude, availableQuantity, round } from "@/lib/stock-availability";
import { isStockVisible } from "@/lib/stock-visibility";
import { normalizeRack } from "@/lib/racks";
import { rackField } from "@/lib/validations/stock";
import { logActivity } from "@/lib/activity-log";
import { labelOfKind } from "@/lib/vocabulary";

/**
 * Racks: where stock sits in the store, and finding it again.
 *
 *   findStock      "is there any, and where?" — every approved central entry of
 *                  the matching products that still has something free,
 *                  grouped by site and then by rack, so the answer reads
 *                  "Bengaluru · Rack 10, row 3 · 7 pcs". Walk straight there.
 *                  A category and a site can be asked for as well as words.
 *   setEntryRack   the goods were moved along the shelves; say where they are
 *                  now. Any time after booking in, not only while a draft.
 *
 * The rack itself is typed when goods are booked in (the entry form and each
 * line of a delivery). Only central stock is on the store's racks — once stock
 * is moved into a department it is that department's, wherever they keep it.
 *
 * Seeing follows the stock list exactly: the same visibility rule, so nobody
 * learns of stock at a site they may not see.
 */

const WHO_MAY_SEE = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE];
/** The people who put goods away or move them in the store */
const WHO_MAY_MOVE = [
  PERMISSIONS.STOCK_CREATE,
  PERMISSIONS.STOCK_EDIT,
  PERMISSIONS.STOCK_MOVE,
  PERMISSIONS.STOCK_APPROVE,
];

export type FoundStock = {
  productId: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  categoryId: string;
  categoryName: string;
  kindLabel: string;
  /** Free to use across every site shown */
  total: number;
  /** What the free stock is worth. Null without stock.value.view. */
  value: number | null;
  sites: {
    locationId: string;
    locationName: string;
    total: number;
    value: number | null;
    /** One per rack, "not recorded" last; each lists the entries on it */
    racks: {
      rack: string | null;
      available: number;
      entries: { id: string; entryNumber: string; batchNumber: string | null; available: number }[];
    }[];
  }[];
};

export async function findStock(
  query: string,
  filter: { categoryId?: string; locationId?: string } = {}
): Promise<FoundStock[]> {
  const user = await requireAnyPermission(WHO_MAY_SEE);
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);
  const q = query.trim();
  if (!q) return [];

  // Every word must match somewhere, as in the product pickers
  const words = q.split(/\s+/).filter(Boolean);
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w, mode: "insensitive" as const } },
          { code: { contains: w, mode: "insensitive" as const } },
          { description: { contains: w, mode: "insensitive" as const } },
          { subcategory: { name: { contains: w, mode: "insensitive" as const } } },
          { category: { name: { contains: w, mode: "insensitive" as const } } },
        ],
      })),
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      unit: true,
      kind: true,
      category: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
    take: 20,
  });
  if (products.length === 0) return [];

  const entries = await prisma.stockEntry.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      status: "APPROVED",
      departmentId: null,
      // A site asked for narrows the answer; what may be SEEN is decided
      // below by the stock list's own rule, never by this.
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
    },
    include: {
      ...availabilityInclude,
      // The visibility rule also needs which department each issue went to
      issues: { select: { quantity: true, departmentId: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const scope = resolveStockScope(user);
  const byProduct = new Map<string, FoundStock["sites"]>();
  for (const entry of entries) {
    if (!isStockVisible(entry, user, scope)) continue;
    const available = round(availableQuantity(entry));
    if (available <= 0 || !entry.productId) continue;

    const sites = byProduct.get(entry.productId) ?? [];
    byProduct.set(entry.productId, sites);
    const locationId = entry.location?.id ?? "none";
    let site = sites.find((s) => s.locationId === locationId);
    if (!site) {
      site = {
        locationId,
        locationName: entry.location?.name ?? "No site recorded",
        total: 0,
        value: canSeeValue ? 0 : null,
        racks: [],
      };
      sites.push(site);
    }
    let rack = site.racks.find((r) => r.rack === entry.rackLocation);
    if (!rack) {
      rack = { rack: entry.rackLocation, available: 0, entries: [] };
      site.racks.push(rack);
    }
    rack.available = round(rack.available + available);
    rack.entries.push({ id: entry.id, entryNumber: entry.entryNumber, batchNumber: entry.batchNumber, available });
    site.total = round(site.total + available);
    // Valued at what the goods were booked in at, the same as the stock report
    if (site.value !== null) site.value = round(site.value + available * entry.unitPrice);
  }

  // Racks in shelf order (10.3 before 10.12), "not recorded" last
  const shelfOrder = (a: string | null, b: string | null) =>
    a === null ? 1 : b === null ? -1 : a.localeCompare(b, undefined, { numeric: true });

  return products.map((p) => {
    const sites = (byProduct.get(p.id) ?? []).sort((a, b) => a.locationName.localeCompare(b.locationName));
    for (const site of sites) site.racks.sort((a, b) => shelfOrder(a.rack, b.rack));
    return {
      productId: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      unit: p.unit,
      categoryId: p.category.id,
      categoryName: p.category.name,
      kindLabel: labelOfKind(p.kind),
      total: round(sites.reduce((sum, s) => sum + s.total, 0)),
      value: canSeeValue ? round(sites.reduce((sum, s) => sum + (s.value ?? 0), 0)) : null,
      sites,
    };
  });
}

/** Record where an entry's goods now sit. An empty rack clears it. */
export async function setEntryRack(entryId: string, rack: string) {
  const user = await requireAnyPermission(WHO_MAY_MOVE);

  const parsed = rackField.safeParse(rack);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const next = normalizeRack(parsed.data);

  const entry = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    include: { issues: { select: { quantity: true, departmentId: true } } },
  });
  // Not visible is reported as not existing, as on the entry page
  if (!entry || !isStockVisible(entry, user, resolveStockScope(user))) {
    return { error: "That stock entry does not exist" };
  }
  if (entry.rackLocation === next) return { success: true };

  await prisma.stockEntry.update({ where: { id: entryId }, data: { rackLocation: next } });
  await logActivity(
    "UPDATED",
    "StockEntry",
    entryId,
    next
      ? `${entry.entryNumber} (${entry.itemName}) is now on rack ${next}${entry.rackLocation ? `, moved from ${entry.rackLocation}` : ""}`
      : `${entry.entryNumber} (${entry.itemName}) no longer has a rack recorded`
  );

  revalidatePath(`/stock/${entryId}`);
  revalidatePath("/stock");
  return { success: true };
}

/**
 * What the Find Stock filters offer: every category, and the sites this person
 * is allowed to see stock at.
 *
 * The site list is narrowed rather than the results alone, so nobody is offered
 * a site that would always come back empty — someone scoped to Bengaluru is not
 * shown Hyderabad in a dropdown. `findStock` still applies the visibility rule
 * itself, so a site posted by hand changes nothing.
 */
export async function getFindStockFilters() {
  const user = await requireAnyPermission(WHO_MAY_SEE);
  const scope = resolveStockScope(user);

  const [categories, locations] = await Promise.all([
    prisma.productCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: {
        isActive: true,
        ...(scope === "all" ? {} : { id: user.locationId ?? "none" }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { categories, locations };
}
