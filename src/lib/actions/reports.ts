"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, resolveStockScope } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { toCsv } from "@/lib/csv";
import {
  visibleToDepartmentScope,
  departmentScopeCandidatesWhere,
} from "@/lib/stock-visibility";
import { kindFilter, groupOf, labelOfKind, type ProductGroup } from "@/lib/vocabulary";
import {
  round,
  heldQuantity,
  committingDispatchItemsWhere,
  committingBuildConsumptionsWhere,
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

const STOCK_ENTRY_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;

function isStockEntryStatus(value: string): value is StockEntryStatus {
  return (STOCK_ENTRY_STATUSES as readonly string[]).includes(value);
}

export async function getStockReport(filters: ReportFilters = {}) {
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
      issues: { select: { departmentId: true, quantity: true } },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
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
    let issued = 0;
    for (const issue of entry.issues) {
      issued += issue.quantity;
      if (restrictToDepartmentId && issue.departmentId !== restrictToDepartmentId) continue;
      const b = bucket(issue.departmentId, issue.departmentId, null);
      b.entries.add(entry.id);
      b.quantity += issue.quantity;
      b.value += issue.quantity * entry.unitPrice;
    }
    // What is still standing here: issues, consignments and builds all taken off.
    const remaining = heldQuantity(entry);
    if (remaining > 0) {
      if (entry.departmentId) {
        // Legacy entries carried their own department
        if (restrictToDepartmentId && entry.departmentId !== restrictToDepartmentId) continue;
        const b = bucket(entry.departmentId, entry.departmentId, null);
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

  const deptIds = [...byDept.values()]
    .map((b) => b.departmentId)
    .filter((id): id is string => id !== null);
  const departments = await prisma.department.findMany({
    where: { id: { in: deptIds } },
    select: { id: true, name: true },
  });
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));

  return [...byDept.values()]
    .map((agg) => ({
      departmentId: agg.departmentId,
      centralLocation: agg.centralLocation,
      departmentName:
        agg.name ??
        (agg.departmentId ? deptMap.get(agg.departmentId) ?? "Unknown" : "Central Stock"),
      entries: agg.entries.size,
      quantity: agg.quantity,
      value: agg.value,
    }))
    .sort((a, b) => b.value - a.value);
}

export async function getStockSummaryStats() {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

  const scope = resolveStockScope(user);

  // Department scope computes from the exact visible set (shared rule)
  if (scope === "department") {
    const candidates = await prisma.stockEntry.findMany({
      where: departmentScopeCandidatesWhere(user.departmentId),
      select: {
        status: true,
        quantity: true,
        totalPrice: true,
        departmentId: true,
        locationId: true,
        createdById: true,
        createdAt: true,
        issues: { select: { departmentId: true, quantity: true } },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
      },
    });
    const visible = candidates.filter((e) => visibleToDepartmentScope(e, user));

    const thirtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 30));
    const recent = visible.filter((e) => e.createdAt >= thirtyDaysAgo);
    const statusCounts = new Map<string, number>();
    for (const e of recent) {
      statusCounts.set(e.status, (statusCounts.get(e.status) ?? 0) + 1);
    }

    const byDepartment = await computeDepartmentDistribution(
      departmentScopeCandidatesWhere(user.departmentId),
      { restrictToDepartmentId: user.departmentId ?? undefined, includeCentral: true }
    );

    return {
      total: visible.length,
      approved: visible.filter((e) => e.status === "APPROVED").length,
      rejected: visible.filter((e) => e.status === "REJECTED").length,
      pending: visible.filter((e) => e.status === "SUBMITTED").length,
      totalApprovedValue: visible
        .filter((e) => e.status === "APPROVED")
        .reduce((sum, e) => sum + e.totalPrice, 0),
      byDepartment: byDepartment.map((d) => ({
        departmentName: d.departmentName,
        count: d.entries,
        totalValue: d.value,
      })),
      last30Days: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    };
  }

  const where: Prisma.StockEntryWhereInput =
    scope === "own" ? { createdById: user.id } : {};

  const [total, approved, rejected, pending, totalValue, byDepartment, monthlyTrend] =
    await Promise.all([
      prisma.stockEntry.count({ where }),
      prisma.stockEntry.count({ where: { ...where, status: "APPROVED" } }),
      prisma.stockEntry.count({ where: { ...where, status: "REJECTED" } }),
      prisma.stockEntry.count({ where: { ...where, status: "SUBMITTED" } }),
      prisma.stockEntry.aggregate({
        where: { ...where, status: "APPROVED" },
        _sum: { totalPrice: true },
      }),
      // Department scope returned earlier — this path is all/own only
      computeDepartmentDistribution(where),
      prisma.stockEntry.groupBy({
        by: ["status"],
        where: {
          ...where,
          createdAt: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30)),
          },
        },
        _count: true,
      }),
    ]);

  return {
    total,
    approved,
    rejected,
    pending,
    totalApprovedValue: totalValue._sum.totalPrice ?? 0,
    byDepartment: byDepartment.map((d) => ({
      departmentName: d.departmentName,
      count: d.entries,
      totalValue: d.value,
    })),
    last30Days: monthlyTrend.map((m) => ({
      status: m.status,
      count: m._count,
    })),
  };
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
      issues: { select: { departmentId: true, quantity: true, createdAt: true } },
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
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
    let issuedTotal = 0;
    let deptQty = 0;
    for (const issue of entry.issues) {
      issuedTotal += issue.quantity;
      if (issue.departmentId === departmentId) {
        deptQty += issue.quantity;
        addToMonth(issue.createdAt, entry.id, issue.quantity, issue.quantity * entry.unitPrice);
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

export async function getInventoryOverview(departmentId?: string) {
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
  itemCode: string | null;
  itemName: string;
  categoryName: string | null;
  /** Which group this sits in — raw materials we buy, or products we make */
  group: ProductGroup;
  kindLabel: string;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  value: number;
  location: string;
  clientName: string | null;
  receivedAt: Date;
}

/**
 * What is physically sitting in one place right now — either a central-stock
 * location (approved, unmoved quantity) or a department (issued + legacy).
 * Backs the searchable/exportable holdings table on the reports page.
 */
export async function getStockHoldings(target: {
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

  const select = {
    id: true,
    entryNumber: true,
    itemCode: true,
    itemName: true,
    supplierName: true,
    quantity: true,
    unitPrice: true,
    locationId: true,
    location: { select: { name: true } },
    clientName: true,
    departmentId: true,
    createdAt: true,
    product: { select: { kind: true, category: { select: { name: true } } } },
    issues: { select: { departmentId: true, quantity: true } },
    dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
    buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
  } as const;

  if (target.centralLocation) {
    const entries = await prisma.stockEntry.findMany({
      where: { status: "APPROVED", departmentId: null, locationId: target.centralLocation },
      select,
      orderBy: { createdAt: "desc" },
    });

    return entries
      .map((e) => {
        const issued = e.issues.reduce((sum, i) => sum + i.quantity, 0);
        // What is still standing here: issues, consignments and builds all taken off.
        const remaining = heldQuantity(e);
        return remaining > 0
          ? {
              entryId: e.id,
              entryNumber: e.entryNumber,
              itemCode: e.itemCode,
              itemName: e.itemName,
              categoryName: e.product?.category.name ?? null,
              group: groupOf(e.product?.kind ?? "RAW"),
              kindLabel: labelOfKind(e.product?.kind ?? "RAW"),
              supplierName: e.supplierName,
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
        const issuedTotal = e.issues.reduce((sum, i) => sum + i.quantity, 0);
        let inDept = e.issues
          .filter((i) => i.departmentId === departmentId)
          .reduce((sum, i) => sum + i.quantity, 0);
        if (e.departmentId === departmentId) {
          inDept += Math.max(0, heldQuantity(e));
        }
        return inDept > 0
          ? {
              entryId: e.id,
              entryNumber: e.entryNumber,
              itemCode: e.itemCode,
              itemName: e.itemName,
              categoryName: e.product?.category.name ?? null,
              group: groupOf(e.product?.kind ?? "RAW"),
              kindLabel: labelOfKind(e.product?.kind ?? "RAW"),
              supplierName: e.supplierName,
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

async function getMonthlyTrend(baseWhere: Prisma.StockEntryWhereInput) {
  const months: { month: string; entries: number; value: number; quantity: number }[] = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

    const result = await prisma.stockEntry.aggregate({
      where: {
        ...baseWhere,
        status: "APPROVED",
        createdAt: { gte: start, lte: end },
      },
      _count: true,
      _sum: { quantity: true, totalPrice: true },
    });

    months.push({
      month: start.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
      entries: result._count,
      value: result._sum.totalPrice ?? 0,
      quantity: result._sum.quantity ?? 0,
    });
  }

  return months;
}

export async function exportStockReport(filters: ReportFilters = {}) {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

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
  if (scope !== "all" && user.locationId) where.locationId = user.locationId;

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
