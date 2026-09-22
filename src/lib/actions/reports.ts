"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, resolveStockScope } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { toCsv } from "@/lib/csv";
import { NO_SITE } from "@/lib/stock-visibility";
import { hideMoney } from "@/lib/hide-money";
import {
  visibleToDepartmentScope,
} from "@/lib/stock-visibility";
import { kindFilter, groupOf, labelOfKind, type ProductGroup } from "@/lib/vocabulary";
import {
  round,
  heldQuantity,
  committingDispatchItemsWhere,
  committingBuildConsumptionsWhere,
  centralWriteOffsWhere,
  issueWriteOffsSelect,
  heldByIssue,
} from "@/lib/stock-availability";
import type { Prisma, StockEntryStatus } from "@prisma/client";

/**
 * Reports: what we are holding, where it is, and what it is worth.
 *
 * Called by: the Reports page only. Everything here is read-only.
 *
 * Two things shape every query. Scope narrows the rows — a department-scoped
 * viewer sees their own department plus the central stock they can pull from —
 * and `stock.value.view` decides whether money appears at all. A role can be
 * trusted with every site's quantities and none of its prices.
 */

interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  status?: string;
  supplierName?: string;
  /** "BOUGHT_IN" or "MADE" — everything when omitted */
  group?: ProductGroup;
}

/**
 * Someone who sees one site (stock.scope.location) sees that site's stock and
 * anything they booked in themselves — in every report, as on the stock list.
 * With no site on record, only their own.
 */
function siteWhere(user: { id: string; locationId?: string | null }): Prisma.StockEntryWhereInput {
  return { OR: [{ locationId: user.locationId ?? NO_SITE }, { createdById: user.id }] };
}

const STOCK_ENTRY_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;

function isStockEntryStatus(value: string): value is StockEntryStatus {
  return (STOCK_ENTRY_STATUSES as readonly string[]).includes(value);
}

/** The stock report — with prices only for those allowed to see them. */
async function getStockReport(filters: ReportFilters = {}) {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);
  const result = await readStockReport(filters);
  return user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW) ? result : hideMoney(result);
}

async function readStockReport(filters: ReportFilters = {}) {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

  const where: Prisma.StockEntryWhereInput = {};

  // Scope: department-scoped users see their department only (including
  // central stock and entries issued to their department)
  const scope = resolveStockScope(user);
  if (scope === "own") {
    where.createdById = user.id;
  } else if (scope === "department" && user.departmentId) {
    where.OR = [
      { departmentId: user.departmentId },
      { departmentId: null },
      { issues: { some: { departmentId: user.departmentId } } },
    ];
  } else if (filters.departmentId) {
    // Only allow department filter for non-dept-manager roles; matches entries
    // assigned to the department or moved there via transfers
    where.OR = [
      { departmentId: filters.departmentId },
      { issues: { some: { departmentId: filters.departmentId } } },
    ];
  }
  if (scope === "location") where.AND = [siteWhere(user)];
  // Checked against the enum rather than trusted. The filter arrives as a
  // string from the report form, and an unrecognised one used to reach Prisma
  // and throw; now it simply does not filter.
  if (filters.status && isStockEntryStatus(filters.status)) {
    where.status = filters.status;
  }
  // Raw materials we buy in versus products we make. Entries that predate the
  // catalog have no product link, so they are only excluded when a group is
  // actually asked for.
  if (filters.group) {
    where.product = { kind: kindFilter(filters.group) };
  }
  if (filters.supplierName) {
    where.supplierName = { contains: filters.supplierName, mode: "insensitive" };
  }
  if (filters.dateFrom || filters.dateTo) {
    // Built as its own value rather than mutated in place through a cast, so
    // Prisma checks the shape instead of us asserting it.
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const entriesRaw = await prisma.stockEntry.findMany({
    where,
    include: {
      product: { select: { kind: true } },
      location: { select: { id: true, name: true } },
      department: { select: { name: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      issues: {
        select: { quantity: true, departmentId: true, department: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Department scope: drop other departments' stock and other users' drafts
  const entries =
    scope === "department"
      ? entriesRaw.filter((e) => visibleToDepartmentScope(e, user))
      : entriesRaw;

  const totalValue = entries.reduce((sum, e) => sum + e.totalPrice, 0);
  const approvedValue = entries
    .filter((e) => e.status === "APPROVED")
    .reduce((sum, e) => sum + e.totalPrice, 0);

  // Both totals side by side, so "what are we holding in raw materials" is
  // answerable without re-running the report under a different filter
  const byGroup = { BOUGHT_IN: { count: 0, value: 0 }, MADE: { count: 0, value: 0 } };
  for (const e of entries) {
    const bucket = byGroup[groupOf(e.product?.kind ?? "RAW")];
    bucket.count += 1;
    bucket.value += e.totalPrice;
  }

  return {
    entries: entries.map((e) => ({ ...e, kindLabel: labelOfKind(e.product?.kind ?? "RAW") })),
    totalValue,
    approvedValue,
    byGroup,
  };
}

// Scope filter for a role: managers see their department's stock, which in the
// central-stock flow means entries issued to their department plus anything
// still in central stock (departmentId null) or legacy-assigned to them.
function departmentScopeWhere(departmentId: string): Prisma.StockEntryWhereInput {
  return {
    OR: [
      { departmentId },
      { departmentId: null },
      { issues: { some: { departmentId } } },
    ],
  };
}

/**
 * Where stock currently sits, per department. Stock moves via StockIssue
 * records, so the distribution is computed from issues (at the entry's unit
 * price), legacy entries that were created directly against a department, and
 * per-location "Central Stock" buckets (Hyderabad / Bengaluru / Client Site)
 * for approved quantity not yet moved anywhere.
 *
 * When `restrictToDepartmentId` is set, other departments' shares of the same
 * entries are excluded. Central-stock buckets are excluded too unless
 * `includeCentral` is set (used for managers, who watch central stock to move
 * it into their department).
 */
async function computeDepartmentDistribution(
  entryWhere: Prisma.StockEntryWhereInput,
  opts: { restrictToDepartmentId?: string; includeCentral?: boolean } = {}
) {
  const { restrictToDepartmentId, includeCentral = false } = opts;
  const entries = await prisma.stockEntry.findMany({
    where: { ...entryWhere, status: "APPROVED" },
    select: {
      id: true,
      departmentId: true,
      locationId: true,
      location: { select: { name: true } },
      quantity: true,
      unitPrice: true,
      // Both department names ride back on THIS query. Turning ids into names
      // used to need a second findMany afterwards, and because it depended on
      // this one's results it could not run in parallel with it — a whole extra
      // round trip for something the join already had.
      department: { select: { name: true } },
      issues: {
        select: {
          departmentId: true,
          quantity: true,
          department: { select: { name: true } },
          ...issueWriteOffsSelect,
        },
      },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
      // The fifth drawdown. Central write-offs only — a department's losses
      // come off its own holding, never off the entry as well.
      writeOffs: { where: centralWriteOffsWhere, select: { quantity: true, status: true } },
    },
  });

  // Bucket key: department id, or "central:<LOCATION>" for unmoved stock
  const byDept = new Map<
    string,
    {
      departmentId: string | null;
      centralLocation: string | null;
      name: string | null;
      entries: Set<string>;
      quantity: number;
      value: number;
    }
  >();

  function bucket(
    key: string,
    departmentId: string | null,
    name: string | null,
    centralLocation: string | null = null
  ) {
    let b = byDept.get(key);
    if (!b) {
      b = { departmentId, centralLocation, name, entries: new Set(), quantity: 0, value: 0 };
      byDept.set(key, b);
    }
    return b;
  }

  for (const entry of entries) {
    for (const issue of entry.issues) {
      if (restrictToDepartmentId && issue.departmentId !== restrictToDepartmentId) continue;
      // What the department still HAS, not what it was handed: a holding it has
      // written off must stop counting towards its inventory and its value.
      const inHand = heldByIssue(issue);
      if (inHand <= 0) continue;
      const b = bucket(issue.departmentId, issue.departmentId, issue.department.name);
      b.entries.add(entry.id);
      b.quantity += inHand;
      b.value += inHand * entry.unitPrice;
    }
    // What is still standing here: issues, consignments and builds all taken off.
    const remaining = heldQuantity(entry);
    if (remaining > 0) {
      if (entry.departmentId) {
        // Legacy entries carried their own department
        if (restrictToDepartmentId && entry.departmentId !== restrictToDepartmentId) continue;
        const b = bucket(entry.departmentId, entry.departmentId, entry.department?.name ?? null);
        b.entries.add(entry.id);
        b.quantity += remaining;
        b.value += remaining * entry.unitPrice;
      } else if (!restrictToDepartmentId || includeCentral) {
        // Unmoved stock stays in the central stock of the receiving location
        const locName = entry.location?.name ?? "Unassigned";
        const label = `Central Stock (${locName})`;
        const b = bucket(`central:${entry.locationId ?? "none"}`, null, label, entry.locationId);
        b.entries.add(entry.id);
        b.quantity += remaining;
        b.value += remaining * entry.unitPrice;
      }
    }
  }

  // Every bucket already carries its name, from the join above.
  return [...byDept.values()]
    .map((agg) => ({
      departmentId: agg.departmentId,
      centralLocation: agg.centralLocation,
      departmentName: agg.name ?? (agg.departmentId ? "Unknown" : "Central Stock"),
      entries: agg.entries.size,
      quantity: agg.quantity,
      value: agg.value,
    }))
    .sort((a, b) => b.value - a.value);
}


/**
 * Inventory numbers for one department, computed from what the department
 * actually HOLDS: quantities issued to it (valued at each entry's unit price)
 * plus legacy entries assigned to it directly. An entry of 14 units with 4
 * issued to Production contributes exactly 4 units to Production's numbers.
 */
async function getDepartmentInventory(departmentId: string) {
  const entries = await prisma.stockEntry.findMany({
    where: {
      status: "APPROVED",
      OR: [{ departmentId }, { issues: { some: { departmentId } } }],
    },
    select: {
      id: true,
      itemName: true,
      supplierName: true,
      quantity: true,
      unitPrice: true,
      departmentId: true,
      createdAt: true,
      issues: { select: { departmentId: true, quantity: true, createdAt: true, ...issueWriteOffsSelect } },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
      // The fifth drawdown. Central write-offs only — a department's losses
      // come off its own holding, never off the entry as well.
      writeOffs: { where: centralWriteOffsWhere, select: { quantity: true, status: true } },
    },
  });

  let totalQuantity = 0;
  let totalValue = 0;
  const itemAgg = new Map<string, { entries: number; quantity: number; value: number }>();
  const supplierAgg = new Map<string, { entries: number; value: number }>();
  // month key (yyyy-m) → aggregates, for the last-6-months trend
  const monthAgg = new Map<string, { entries: Set<string>; quantity: number; value: number }>();

  function addToMonth(date: Date, entryId: string, quantity: number, value: number) {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let m = monthAgg.get(key);
    if (!m) {
      m = { entries: new Set(), quantity: 0, value: 0 };
      monthAgg.set(key, m);
    }
    m.entries.add(entryId);
    m.quantity += quantity;
    m.value += value;
  }

  let entryCount = 0;
  for (const entry of entries) {
    let deptQty = 0;
    for (const issue of entry.issues) {
      if (issue.departmentId === departmentId) {
        // Net of what this department has written off — see heldByIssue().
        const inHand = heldByIssue(issue);
        deptQty += inHand;
        if (inHand > 0) {
          addToMonth(issue.createdAt, entry.id, inHand, inHand * entry.unitPrice);
        }
      }
    }
    if (entry.departmentId === departmentId) {
      // What is still standing here: issues, consignments and builds all taken off.
      const remaining = heldQuantity(entry);
      if (remaining > 0) {
        deptQty += remaining;
        addToMonth(entry.createdAt, entry.id, remaining, remaining * entry.unitPrice);
      }
    }
    if (deptQty === 0) continue;

    entryCount += 1;
    const deptValue = deptQty * entry.unitPrice;
    totalQuantity += deptQty;
    totalValue += deptValue;

    const item = itemAgg.get(entry.itemName) ?? { entries: 0, quantity: 0, value: 0 };
    item.entries += 1;
    item.quantity += deptQty;
    item.value += deptValue;
    itemAgg.set(entry.itemName, item);

    const supplier = supplierAgg.get(entry.supplierName) ?? { entries: 0, value: 0 };
    supplier.entries += 1;
    supplier.value += deptValue;
    supplierAgg.set(entry.supplierName, supplier);
  }

  const now = new Date();
  const monthlyTrend: { month: string; entries: number; value: number; quantity: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = monthAgg.get(`${d.getFullYear()}-${d.getMonth()}`);
    monthlyTrend.push({
      month: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
      entries: m?.entries.size ?? 0,
      quantity: m?.quantity ?? 0,
      value: m?.value ?? 0,
    });
  }

  return {
    entryCount,
    totalQuantity,
    totalValue,
    topItems: [...itemAgg.entries()]
      .map(([itemName, agg]) => ({ itemName, ...agg }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    topSuppliers: [...supplierAgg.entries()]
      .map(([supplierName, agg]) => ({ supplierName, ...agg }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    monthlyTrend,
  };
}

/** The inventory overview — with values only for those allowed to see them. */
export async function getInventoryOverview(departmentId?: string) {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);
  const result = await readInventoryOverview(departmentId);
  return user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW) ? result : hideMoney(result);
}

async function readInventoryOverview(departmentId?: string) {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);
  const scope = resolveStockScope(user);

  // Department-scoped users may only drill into their own department
  if (scope === "department") {
    departmentId =
      departmentId && departmentId === user.departmentId ? departmentId : undefined;
  }

  // "Connected to a department" now means directly assigned (legacy) OR moved
  // there via a stock issue
  let baseWhere: Prisma.StockEntryWhereInput = {};
  if (scope === "own") {
    baseWhere = { createdById: user.id };
  } else if (scope === "department" && user.departmentId) {
    baseWhere = departmentScopeWhere(user.departmentId);
  } else if (departmentId) {
    baseWhere = {
      OR: [{ departmentId }, { issues: { some: { departmentId } } }],
    };
  }
  if (scope === "location") baseWhere = { AND: [baseWhere, siteWhere(user)] };

  // A department drill-down reports what that department actually holds
  if (departmentId && scope !== "department") {
    const [holdings, distribution, pipeline] = await Promise.all([
      getDepartmentInventory(departmentId),
      computeDepartmentDistribution(baseWhere, { restrictToDepartmentId: departmentId }),
      prisma.stockEntry.aggregate({
        where: baseWhere,
        _sum: { totalPrice: true },
        _count: true,
      }),
    ]);

    return {
      totalEntries: pipeline._count,
      totalValue: pipeline._sum.totalPrice ?? 0,
      approvedEntries: holdings.entryCount,
      approvedQuantity: holdings.totalQuantity,
      approvedValue: holdings.totalValue,
      byDepartment: distribution,
      topItems: holdings.topItems,
      topSuppliers: holdings.topSuppliers,
      monthlyTrend: holdings.monthlyTrend,
    };
  }

  // Get all approved entries (stock "in") grouped by department
  const [
    totalStockIn,
    totalStockInValue,
    stockInByDepartment,
    topItems,
    topSuppliers,
    monthlyTrend,
  ] = await Promise.all([
    // Total approved entries count and quantity
    prisma.stockEntry.aggregate({
      where: { ...baseWhere, status: "APPROVED" },
      _count: true,
      _sum: { quantity: true, totalPrice: true },
    }),
    // Total value across all statuses
    prisma.stockEntry.aggregate({
      where: baseWhere,
      _sum: { totalPrice: true },
      _count: true,
    }),
    // Where the stock currently sits. A selected department sees only its own
    // holdings; managers additionally see central stock (they move it);
    // the all-departments view shows everything incl. per-location central
    computeDepartmentDistribution(
      baseWhere,
      scope === "department" && user.departmentId
        ? { restrictToDepartmentId: user.departmentId, includeCentral: true }
        : departmentId
          ? { restrictToDepartmentId: departmentId }
          : {}
    ),
    // Top items by total quantity (approved)
    prisma.stockEntry.groupBy({
      by: ["itemName"],
      where: { ...baseWhere, status: "APPROVED" },
      _count: true,
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { totalPrice: "desc" } },
      take: 10,
    }),
    // Top suppliers by value
    prisma.stockEntry.groupBy({
      by: ["supplierName"],
      where: { ...baseWhere, status: "APPROVED" },
      _count: true,
      _sum: { totalPrice: true },
      orderBy: { _sum: { totalPrice: "desc" } },
      take: 10,
    }),
    // Monthly trend (last 6 months)
    getMonthlyTrend(baseWhere),
  ]);

  return {
    totalEntries: totalStockInValue._count,
    totalValue: totalStockInValue._sum.totalPrice ?? 0,
    approvedEntries: totalStockIn._count ?? 0,
    approvedQuantity: totalStockIn._sum.quantity ?? 0,
    approvedValue: totalStockIn._sum.totalPrice ?? 0,
    byDepartment: stockInByDepartment,
    topItems: topItems.map((item) => ({
      itemName: item.itemName,
      entries: item._count,
      quantity: item._sum.quantity ?? 0,
      value: item._sum.totalPrice ?? 0,
    })),
    topSuppliers: topSuppliers.map((s) => ({
      supplierName: s.supplierName,
      entries: s._count,
      value: s._sum.totalPrice ?? 0,
    })),
    monthlyTrend,
  };
}

export interface StockHoldingRow {
  entryId: string;
  entryNumber: string;
  /**
   * The catalog product this receipt is of. Null on entries that predate the
   * catalog. It is what the Reports page groups repeat receipts by — see
   * `src/lib/stock-grouping.ts` for the fallbacks when it is missing.
   */
  productId: string | null;
  itemCode: string | null;
  itemName: string;
  categoryName: string | null;
  /** Which group this sits in — raw materials we buy, or products we make */
  group: ProductGroup;
  kindLabel: string;
  supplierName: string;
  /** The supplier lot these goods belong to, when one was recorded */
  batchNumber: string | null;
  quantity: number;
  unitPrice: number;
  value: number;
  location: string;
  clientName: string | null;
  receivedAt: Date;
}

/** What a site or department holds — with prices only for those allowed to see them. */
export async function getStockHoldings(target: {
  departmentId?: string;
  /** A location id — central stock is scoped per site */
  centralLocation?: string;
}): Promise<StockHoldingRow[]> {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);
  const result = await readStockHoldings(target);
  return user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW) ? result : hideMoney(result);
}

/**
 * What is physically sitting in one place right now — either a central-stock
 * location (approved, unmoved quantity) or a department (issued + legacy).
 * Backs the searchable/exportable holdings table on the reports page.
 */
async function readStockHoldings(target: {
  departmentId?: string;
  /** A location id — central stock is scoped per site */
  centralLocation?: string;
}): Promise<StockHoldingRow[]> {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

  // Department-scoped users may inspect central stock and their own department only
  const scope = resolveStockScope(user);
  if (scope === "own") return [];
  if (
    scope === "department" &&
    target.departmentId &&
    target.departmentId !== user.departmentId
  ) {
    return [];
  }
  // Someone who sees one site asks only about that site: its central stock,
  // or a department there
  if (scope === "location" || scope === "department") {
    if (target.centralLocation && target.centralLocation !== user.locationId) return [];
    if (target.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: target.departmentId }, select: { locationId: true } });
      if (!department || department.locationId !== user.locationId) return [];
    }
  }

  const select = {
    id: true,
    entryNumber: true,
    productId: true,
    itemCode: true,
    itemName: true,
    supplierName: true,
    batchNumber: true,
    quantity: true,
    unitPrice: true,
    locationId: true,
    location: { select: { name: true } },
    clientName: true,
    departmentId: true,
    createdAt: true,
    product: { select: { kind: true, category: { select: { name: true } } } },
    issues: { select: { departmentId: true, quantity: true, ...issueWriteOffsSelect } },
    dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
    buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
    // The fifth drawdown. Central write-offs only — a department's losses
    // come off its own holding, never off the entry as well.
    writeOffs: { where: centralWriteOffsWhere, select: { quantity: true, status: true } },
  } as const;

  if (target.centralLocation) {
    const entries = await prisma.stockEntry.findMany({
      where: { status: "APPROVED", departmentId: null, locationId: target.centralLocation },
      select,
      orderBy: { createdAt: "desc" },
    });

    return entries
      .map((e) => {
        // What is still standing here: issues, consignments and builds all taken off.
        const remaining = heldQuantity(e);
        return remaining > 0
          ? {
              entryId: e.id,
              entryNumber: e.entryNumber,
              productId: e.productId,
              itemCode: e.itemCode,
              itemName: e.itemName,
              categoryName: e.product?.category.name ?? null,
              group: groupOf(e.product?.kind ?? "RAW"),
              kindLabel: labelOfKind(e.product?.kind ?? "RAW"),
              supplierName: e.supplierName,
              batchNumber: e.batchNumber,
              quantity: remaining,
              unitPrice: e.unitPrice,
              value: remaining * e.unitPrice,
              location: e.location?.name ?? "Unassigned",
              clientName: e.clientName,
              receivedAt: e.createdAt,
            }
          : null;
      })
      .filter((r) => r !== null);
  }

  if (target.departmentId) {
    const departmentId = target.departmentId;
    const entries = await prisma.stockEntry.findMany({
      where: {
        status: "APPROVED",
        OR: [{ departmentId }, { issues: { some: { departmentId } } }],
      },
      select,
      orderBy: { createdAt: "desc" },
    });

    return entries
      .map((e) => {
        // Net of write-offs: a department that has written its holding off is
        // not still holding it.
        let inDept = e.issues
          .filter((i) => i.departmentId === departmentId)
          .reduce((sum, i) => sum + heldByIssue(i), 0);
        if (e.departmentId === departmentId) {
          inDept += Math.max(0, heldQuantity(e));
        }
        return inDept > 0
          ? {
              entryId: e.id,
              entryNumber: e.entryNumber,
              productId: e.productId,
              itemCode: e.itemCode,
              itemName: e.itemName,
              categoryName: e.product?.category.name ?? null,
              group: groupOf(e.product?.kind ?? "RAW"),
              kindLabel: labelOfKind(e.product?.kind ?? "RAW"),
              supplierName: e.supplierName,
              batchNumber: e.batchNumber,
              quantity: inDept,
              unitPrice: e.unitPrice,
              value: inDept * e.unitPrice,
              location: e.location?.name ?? "Unassigned",
              clientName: e.clientName,
              receivedAt: e.createdAt,
            }
          : null;
      })
      .filter((r) => r !== null);
  }

  return [];
}

/**
 * Six months of arrivals, in ONE round trip.
 *
 * This used to run six `aggregate` calls in a loop, each awaited before the
 * next began. Against a database ~220ms away that is 1.3 seconds of waiting for
 * six numbers, and it was the single slowest thing on the reports page.
 *
 * Now the window is fetched once and bucketed here. The rows are small (three
 * columns, and only entries approved in the last six months), so doing the
 * arithmetic in JavaScript costs nothing next to what a round trip costs.
 */
async function getMonthlyTrend(baseWhere: Prisma.StockEntryWhereInput) {
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const entries = await prisma.stockEntry.findMany({
    where: {
      ...baseWhere,
      status: "APPROVED",
      createdAt: { gte: windowStart },
    },
    select: { createdAt: true, quantity: true, totalPrice: true },
  });

  // "2026-7" → the running totals for that month. Keyed the same way the loop
  // below looks them up, so a month with no arrivals simply finds nothing and
  // reports zeroes rather than being missing from the chart.
  const buckets = new Map<string, { entries: number; quantity: number; value: number }>();
  for (const entry of entries) {
    const key = `${entry.createdAt.getFullYear()}-${entry.createdAt.getMonth()}`;
    const bucket = buckets.get(key) ?? { entries: 0, quantity: 0, value: 0 };
    bucket.entries += 1;
    bucket.quantity += entry.quantity;
    bucket.value += entry.totalPrice;
    buckets.set(key, bucket);
  }

  const months: { month: string; entries: number; value: number; quantity: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const bucket = buckets.get(`${start.getFullYear()}-${start.getMonth()}`);
    months.push({
      month: start.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
      entries: bucket?.entries ?? 0,
      value: bucket?.value ?? 0,
      quantity: bucket?.quantity ?? 0,
    });
  }

  return months;
}

export async function exportStockReport(filters: ReportFilters = {}) {
  const user = await requirePermission(PERMISSIONS.REPORTS_EXPORT);

  const { entries } = await getStockReport(filters);

  // Monetary columns require the stock.value.view permission
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  const headers = [
    "Entry Number",
    "Item Code",
    "Item Name",
    "Kind",
    "Supplier",
    "Quantity",
    ...(canSeeValue ? ["Unit Price", "Total Price"] : []),
    "Location",
    "Client",
    "Department",
    "Status",
    "Created By",
    "Created Date",
    "Invoice Number",
  ];

  const rows = entries.map((e) => [
    e.entryNumber,
    e.itemCode ?? "",
    e.itemName,
    e.kindLabel,
    e.supplierName,
    e.quantity.toString(),
    ...(canSeeValue ? [e.unitPrice.toFixed(2), e.totalPrice.toFixed(2)] : []),
    e.location?.name ?? "Unassigned",
    e.clientName ? `${e.clientName}${e.clientLocation ? ` (${e.clientLocation})` : ""}` : "",
    e.issues.length > 0
      ? [...new Set(e.issues.map((i) => i.department.name))].join("; ")
      : e.department?.name ?? `Central Stock (${e.location?.name ?? "Unassigned"})`,
    e.status,
    e.createdBy.name,
    new Date(e.createdAt).toLocaleDateString("en-IN"),
    e.invoiceNumber ?? "",
  ]);

  return { success: true as const, csv: toCsv(headers, rows), rowCount: rows.length };
}

/**
 * What is on the shop floor right now: runs whose components have been consumed
 * but which have not produced their goods yet.
 *
 * This is the sheet's "ON THE FLOOR". It is deliberately not counted as stock
 * anywhere — the product does not exist yet — so it needs its own line rather
 * than being folded into a total that would then be wrong.
 */
export async function getWorkInProgress() {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

  const scope = resolveStockScope(user);
  const where: Prisma.BuildWhereInput = { status: "IN_PROGRESS" };
  if (scope !== "all") where.locationId = user.locationId ?? NO_SITE;

  const builds = await prisma.build.findMany({
    where,
    select: {
      id: true,
      buildNumber: true,
      quantity: true,
      createdAt: true,
      product: { select: { code: true, name: true, unit: true } },
      location: { select: { name: true } },
      outputs: { select: { quantity: true } },
      consumptions: {
        select: { quantity: true, stockEntry: { select: { unitPrice: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  const rows = builds.map((b) => {
    const finished = b.outputs.reduce((sum, o) => sum + o.quantity, 0);
    const onFloor = b.quantity - finished;
    // What the unfinished portion has already swallowed in components
    const consumedValue = b.consumptions.reduce(
      (sum, c) => sum + c.quantity * c.stockEntry.unitPrice,
      0
    );

    return {
      buildId: b.id,
      buildNumber: b.buildNumber,
      productCode: b.product.code,
      productName: b.product.name,
      unit: b.product.unit,
      locationName: b.location.name,
      started: b.quantity,
      finished,
      onFloor,
      startedAt: b.createdAt,
      /** How long it has been sitting there — the number that spots a stalled run */
      daysOpen: Math.floor((Date.now() - b.createdAt.getTime()) / 86_400_000),
      tiedUpValue: canSeeValue
        ? round((consumedValue / b.quantity) * onFloor)
        : null,
    };
  });

  return {
    rows: rows.filter((r) => r.onFloor > 0),
    totalOnFloor: rows.reduce((sum, r) => sum + r.onFloor, 0),
    tiedUpValue: canSeeValue
      ? round(rows.reduce((sum, r) => sum + (r.tiedUpValue ?? 0), 0))
      : null,
  };
}
